/**
 * AlgoViz 入库流水线 + 实时检测。
 *
 * 入库流水线 generate(problem):
 *   阶段 1：调 status client → 解析 Status TSX + Schema → onStatusReady 回调
 *   阶段 2：调 animation client（携带阶段 1 的 statusCode 上下文）→ 解析 Anim TSX → onAnimationReady
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
import type { AlgoVizDetectionSchema, Problem } from '../core/types';
import {
  buildAnimationPrompt,
  buildDetectPrompt,
  buildStatusPrompt,
  parseAnimationOutput,
  parseDetectOutput,
  parseStatusOutput,
} from './prompts';

export interface AlgoVizGenerateCallbacks {
  /** 阶段 1 完成（Status 入库），UI 应立即 refresh 让用户看到模块卡片 */
  onStatusReady?: (statusCode: string, schema: AlgoVizDetectionSchema) => void | Promise<void>;
  /** 阶段 2 完成（Animation 入库），UI 解锁播放按钮 */
  onAnimationReady?: (animationCode: string) => void | Promise<void>;
  /** 任一阶段失败 */
  onError?: (stage: 'status' | 'animation', err: Error) => void;
}

export interface AlgoVizClients {
  status: AIClient | null;
  animation: AIClient | null;
  detect: AIClient | null;
}

export class AlgoVizService {
  constructor(private readonly clients: AlgoVizClients) {}

  /**
   * 完整流水线：先 Status，回调通知 → 再 Animation 后台续。
   * 不阻塞 caller：caller 拿到 promise 但通常不 await。
   */
  async generate(problem: Problem, cb: AlgoVizGenerateCallbacks = {}): Promise<void> {
    if (!this.clients.status) {
      cb.onError?.('status', new Error('未配置 Status 工位模型（主云端不可用且无 override）'));
      return;
    }
    // 阶段 1：Status + Schema
    let schema: AlgoVizDetectionSchema | null = null;
    let statusCodeRef = '';
    try {
      const { system, user } = buildStatusPrompt({
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
        maxTokens: 8000,
        temperature: 0.3,
      });
      const parsed = parseStatusOutput(raw);
      if (!parsed) {
        throw new Error('Status 输出解析失败（双块格式不完整）');
      }
      schema = parsed.schema;
      statusCodeRef = parsed.statusCode;
      await cb.onStatusReady?.(parsed.statusCode, parsed.schema);
    } catch (e: any) {
      cb.onError?.('status', e instanceof Error ? e : new Error(String(e)));
      return; // 阶段 1 失败不进阶段 2
    }

    // 阶段 2：Animation
    if (!this.clients.animation || !schema) {
      cb.onError?.(
        'animation',
        new Error('未配置 Animation 工位模型（主云端不可用且无 override）'),
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
      });
      const raw = await this.clients.animation.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 8000,
        temperature: 0.3,
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
      });
      const raw = await this.clients.animation.chat({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxTokens: 8000,
        temperature: 0.3,
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
