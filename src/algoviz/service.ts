/**
 * AlgoViz 入库流水线 + 实时检测。
 *
 * 入库流水线 generate(problem):
 *   阶段 0：Trace
 *   阶段 1：Status 与 VisualPlan 并行生成；Status 完成即 onStatusReady 回调
 *   阶段 2：等待 Status + VisualPlan 后调 animation client → 解析 Anim TSX → onAnimationReady
 *
 * 单题幂等：caller 应自己判断 problem.algoViz?.status 是否已 ready，避免重复跑。
 *
 * 老题模式 generateAnimationOnly(problem)：
 *   跳过阶段 1，直接阶段 2，但仍需要一个 schema（用 fallback：从 problem 现有数据合成一个简易 schema）
 *
 * 实时检测 detect(code, schema)：
 *   一次调用，输出极短 0/1 序列，<8s 完成。
 */
import type { AIClient } from '../core/ai/client';
import type { AlgoVizDetectionSchema, AlgoVizTrace, AlgoVizVisualPlan, Problem } from '../core/types';
import {
  buildAnimationPrompt,
  buildDetectPrompt,
  buildStatusPrompt,
  buildTracePrompt,
  buildVisualPlanPrompt,
  parseAnimationOutput,
  parseDetectOutput,
  parseStatusOutput,
  parseTraceOutput,
  parseVisualPlanOutput,
} from './prompts';

export interface AlgoVizGenerateCallbacks {
  onTraceReady?: (trace: AlgoVizTrace) => void | Promise<void>;
  onVisualPlanReady?: (visualPlan: AlgoVizVisualPlan) => void | Promise<void>;
  /** 阶段 1 完成（Status 入库），UI 应立即 refresh 让用户看到模块卡片 */
  onStatusReady?: (statusCode: string, schema: AlgoVizDetectionSchema) => void | Promise<void>;
  /** 阶段 2 完成（Animation 入库），UI 解锁播放按钮 */
  onAnimationReady?: (animationCode: string) => void | Promise<void>;
  /** 任一阶段失败 */
  onError?: (stage: 'trace' | 'visual-plan' | 'status' | 'animation', err: Error) => void;
}

export interface AlgoVizClients {
  status: AIClient | null;
  animation: AIClient | null;
  detect: AIClient | null;
}

export class AlgoVizService {
  constructor(private readonly clients: AlgoVizClients) {}

  /**
   * 完整流水线：Trace 后并行生成 Status / VisualPlan；Status 先到先显示，再等 VisualPlan 生成 Animation。
   * 不阻塞 caller：caller 拿到 promise 但通常不 await。
   */
  async generate(problem: Problem, cb: AlgoVizGenerateCallbacks = {}): Promise<void> {
    if (!this.clients.status) {
      cb.onError?.('status', new Error('未配置 Status 工位模型（高质量模型不可用且无 override）'));
      return;
    }
    let trace: AlgoVizTrace | null = null;
    try {
      const { system, user } = buildTracePrompt({
        title: problem.title,
        statement: problem.statement,
        constraints: problem.constraints,
        examples: problem.examples,
      });
      const raw = await this.clients.status.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 5000,
        temperature: 0.2,
        disableThinking: true,
      });
      trace = parseTraceOutput(raw);
      if (!trace) {
        throw new Error('Trace 输出解析失败');
      }
      await cb.onTraceReady?.(trace);
    } catch (e: any) {
      cb.onError?.('trace', e instanceof Error ? e : new Error(String(e)));
      return;
    }

    const visualPlanTask = (async (): Promise<{ visualPlan: AlgoVizVisualPlan } | { error: Error }> => {
      try {
        const { system, user } = buildVisualPlanPrompt({
          title: problem.title,
          statement: problem.statement,
          constraints: problem.constraints,
          examples: problem.examples,
          trace,
        });
        const raw = await this.clients.status!.chat({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          maxTokens: 6000,
          temperature: 0.25,
          disableThinking: true,
        });
        const visualPlan = parseVisualPlanOutput(raw);
        if (!visualPlan) {
          throw new Error('VisualPlan 输出解析失败');
        }
        await cb.onVisualPlanReady?.(visualPlan);
        return { visualPlan };
      } catch (e: any) {
        return { error: e instanceof Error ? e : new Error(String(e)) };
      }
    })();

    const statusTask = (async (): Promise<
      | { statusCode: string; schema: AlgoVizDetectionSchema }
      | { error: Error }
    > => {
      try {
        const { system, user } = buildStatusPrompt({
          title: problem.title,
          statement: problem.statement,
          constraints: problem.constraints,
          examples: problem.examples,
          trace,
        });
        const raw = await this.clients.status!.chat({
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          maxTokens: 8000,
          temperature: 0.3,
          disableThinking: true,
        });
        const parsed = parseStatusOutput(raw);
        if (!parsed) {
          throw new Error('Status 输出解析失败（双块格式不完整）');
        }
        await cb.onStatusReady?.(parsed.statusCode, parsed.schema);
        return { statusCode: parsed.statusCode, schema: parsed.schema };
      } catch (e: any) {
        return { error: e instanceof Error ? e : new Error(String(e)) };
      }
    })();

    const statusResult = await statusTask;
    if ('error' in statusResult) {
      cb.onError?.('status', statusResult.error);
      await visualPlanTask;
      return;
    }

    const visualPlanResult = await visualPlanTask;
    if ('error' in visualPlanResult) {
      cb.onError?.('visual-plan', visualPlanResult.error);
      return;
    }

    const { schema, statusCode: statusCodeRef } = statusResult;
    const { visualPlan } = visualPlanResult;

    // 阶段 2：Animation
    if (!this.clients.animation) {
      cb.onError?.(
        'animation',
        new Error('未配置 Animation 工位模型（高质量模型不可用且无 override）'),
      );
      return;
    }
    try {
      const { system, user } = buildAnimationPrompt({
        title: problem.title,
        statement: problem.statement,
        constraints: problem.constraints,
        examples: problem.examples,
        statusCode: statusCodeRef,
        schema,
        trace,
        visualPlan,
      });
      const raw = await this.clients.animation.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 8000,
        temperature: 0.3,
        disableThinking: true,
      });
      const animationCode = parseAnimationOutput(raw);
      if (!animationCode) {
        throw new Error('Animation 输出解析失败');
      }
      await cb.onAnimationReady?.(animationCode);
    } catch (e: any) {
      cb.onError?.('animation', e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * 老题专用：跳过 Status，仅生成 Animation。
   * 必须 caller 提供 schema（通常从已生成的 algoViz.detectionSchema 拿）。
   * 如果完全是老题没 schema，需要先调 generate() 一次。
   */
  async generateAnimationOnly(
    problem: Problem,
    schema: AlgoVizDetectionSchema,
    statusCodeRef: string,
    cb: { onReady?: (code: string) => void | Promise<void>; onError?: (e: Error) => void } = {},
  ): Promise<void> {
    if (!this.clients.animation) {
      cb.onError?.(new Error('未配置 Animation 工位模型'));
      return;
    }
    try {
      const { system, user } = buildAnimationPrompt({
        title: problem.title,
        statement: problem.statement,
        constraints: problem.constraints,
        examples: problem.examples,
        statusCode: statusCodeRef,
        schema,
        trace: problem.algoViz?.trace ?? null,
        visualPlan: problem.algoViz?.visualPlan ?? null,
      });
      const raw = await this.clients.animation.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 8000,
        temperature: 0.3,
        disableThinking: true,
      });
      const animationCode = parseAnimationOutput(raw);
      if (!animationCode) {
        throw new Error('Animation 输出解析失败');
      }
      await cb.onReady?.(animationCode);
    } catch (e: any) {
      cb.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /**
   * 实时检测：返回 { m1: true, m2: false, ... } 或 null（不可用 / 输出无效）。
   * caller 应该在外层 debounce / throttle，单次调用本身要尽量快（< 8s）。
   */
  async detect(
    code: string,
    schema: AlgoVizDetectionSchema,
    signal?: AbortSignal,
  ): Promise<Record<string, boolean> | null> {
    if (!this.clients.detect) return null;
    if (!code.trim()) {
      // 没代码直接全 false，不调模型
      const out: Record<string, boolean> = {};
      for (const m of schema.modules) out[m.id] = false;
      return out;
    }
    try {
      const { system, user } = buildDetectPrompt({ schema, code });
      const raw = await this.clients.detect.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 32,
        temperature: 0,
        timeoutMs: 8_000,
        signal,
      });
      return parseDetectOutput(raw, schema);
    } catch (e) {
      if (typeof console !== 'undefined' && console.debug) {
        console.debug('[AlgoViz.detect] failed', e);
      }
      return null;
    }
  }
}
