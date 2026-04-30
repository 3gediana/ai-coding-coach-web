/**
 * 算法可视化面板（FeedbackPanel 的第三 Tab 内容）。
 *
 * 三种状态决定渲染：
 *   - 没激活题目                 → 引导文案
 *   - algoViz 缺失或 idle/失败   → 老题按钮「为这道题生成」
 *   - generating-status          → 生成 Status 中的 spinner
 *   - status-ready / generating-anim → 实时 Status 显示 + 动画生成中提示
 *   - ready                      → 实时 Status + 「▶ 播放动画」按钮
 *
 * Status 组件挂载时把 store.moduleStatusByProblem[problemId] 作为 props 传入。
 * Animation 组件由 @remotion/player 接管渲染。
 */
import * as React from 'react';
import { useMemo, useState } from 'react';
import { Loader2, Play, RefreshCw, AlertTriangle, Sparkles, X } from 'lucide-react';
import { Player } from '@remotion/player';
import * as Remotion from 'remotion';
import { useStore } from '../lib/store';
import { LLMComponentRenderer, compileLLMComponent } from '../algoviz/runtime';
import type { Problem } from '../core/types';

const REMOTION_GLOBALS = {
  React,
  Remotion: {
    useCurrentFrame: Remotion.useCurrentFrame,
    interpolate: Remotion.interpolate,
    spring: Remotion.spring,
    AbsoluteFill: Remotion.AbsoluteFill,
    Easing: Remotion.Easing,
  },
};

const STATUS_GLOBALS = { React };

export function AlgoVizPanel(): React.ReactElement {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const problem = useStore((s) =>
    activeProblemId ? s.problems.find((p) => p.id === activeProblemId) ?? null : null,
  );
  const moduleStatus = useStore((s) =>
    activeProblemId ? s.moduleStatusByProblem[activeProblemId] : undefined,
  );
  const detecting = useStore((s) =>
    activeProblemId ? !!s.algoVizDetectingByProblem[activeProblemId] : false,
  );
  const requestGen = useStore((s) => s.requestAlgoVizGeneration);
  const requestAnimOnly = useStore((s) => s.requestAlgoVizAnimationOnly);

  if (!problem) {
    return (
      <div className="flex-1 flex items-center justify-center text-[11px] text-ink-mute px-4 text-center">
        激活一道题后，这里会出现：
        <br />
        左侧实时模块进度 + AC 后可播放的算法动画。
      </div>
    );
  }

  const algoViz = problem.algoViz;
  const status = algoViz?.status ?? 'idle';
  const statusCode = algoViz?.statusCode ?? null;
  const animationCode = algoViz?.animationCode ?? null;
  const schema = algoViz?.detectionSchema ?? null;

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <HeaderBar
        algoName={schema?.algoName}
        status={status}
        detecting={detecting}
        errorMessage={algoViz?.errorMessage}
      />
      <div className="flex-1 overflow-y-auto">
        {(status === 'idle' || status === 'failed') && (
          <IdleOrFailedView
            problem={problem}
            errorMessage={algoViz?.errorMessage}
            onGenerateFull={() => void requestGen(problem.id, { force: status === 'failed' })}
            onGenerateAnimOnly={() => void requestAnimOnly(problem.id)}
          />
        )}

        {status === 'generating-status' && (
          <GeneratingView title="生成 Status 模块卡片中…" subtitle="预计 ~20 秒" />
        )}

        {(status === 'status-ready' ||
          status === 'generating-anim' ||
          status === 'ready') && (
          <ReadyView
            problem={problem}
            statusCode={statusCode}
            animationCode={animationCode}
            schema={schema}
            moduleStatus={moduleStatus}
            isAnimGenerating={status === 'generating-anim'}
            onRegenerateAnim={() => void requestAnimOnly(problem.id)}
          />
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Header
// ──────────────────────────────────────────────────────────────────────

function HeaderBar({
  algoName,
  status,
  detecting,
  errorMessage,
}: {
  algoName?: string;
  status: NonNullable<Problem['algoViz']>['status'];
  detecting: boolean;
  errorMessage?: string;
}): React.ReactElement {
  const label = (() => {
    switch (status) {
      case 'idle':
        return '未生成';
      case 'generating-status':
        return '生成 Status…';
      case 'status-ready':
        return 'Status 就绪 · Animation 生成中';
      case 'generating-anim':
        return 'Animation 生成中…';
      case 'ready':
        return '就绪';
      case 'failed':
        return '失败';
    }
  })();
  return (
    <div
      className="h-8 px-3 flex items-center gap-2 text-[11px] border-b border-line bg-bg-elev/50 shrink-0"
      title={errorMessage ?? ''}
    >
      <Sparkles size={12} className="text-accent" />
      <span className="text-ink-mute">算法可视化</span>
      {algoName && <span className="font-mono text-accent">{algoName}</span>}
      <div className="flex-1" />
      <span
        className={
          status === 'failed'
            ? 'text-bad'
            : status === 'ready'
              ? 'text-ok'
              : 'text-ink-mute'
        }
      >
        {label}
      </span>
      {detecting && <Loader2 size={11} className="animate-spin text-accent" />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 各状态视图
// ──────────────────────────────────────────────────────────────────────

function IdleOrFailedView({
  problem,
  errorMessage,
  onGenerateFull,
  onGenerateAnimOnly,
}: {
  problem: Problem;
  errorMessage?: string;
  onGenerateFull: () => void;
  onGenerateAnimOnly: () => void;
}): React.ReactElement {
  const aiOk = useStore((s) => {
    const cfg = s.aiConfig;
    return cfg.provider === 'ollama' ? !!cfg.baseUrl : !!cfg.apiKey;
  });
  const failed = !!errorMessage;
  return (
    <div className="px-4 py-6 space-y-4">
      <div className="text-[12px] text-ink-mute leading-relaxed">
        当前题目「
        <span className="text-ink font-medium">{problem.title}</span>
        」还没有可视化数据。
      </div>
      {failed && (
        <div className="px-3 py-2 rounded-md bg-bad/10 border border-bad/30 text-[11px] text-bad leading-relaxed">
          <div className="flex items-center gap-1 font-semibold mb-1">
            <AlertTriangle size={11} /> 上次生成失败
          </div>
          <div className="font-mono text-[10.5px] opacity-80 break-all">
            {errorMessage}
          </div>
        </div>
      )}
      {!aiOk && (
        <div className="text-[11px] text-warn">
          请先在右上角齿轮里配置 AI 服务（或在「算法可视化模型」里单独配 DeepSeek）
        </div>
      )}
      <div className="space-y-2">
        <button
          onClick={onGenerateFull}
          disabled={!aiOk}
          className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          title="生成模块进度卡片 + AC 动画（耗时约 90-120 秒，后台进行不阻塞做题）"
        >
          <Sparkles size={13} />
          {failed ? '重新生成全套（Status + Animation）' : '生成 Status + Animation（推荐）'}
        </button>
        <button
          onClick={onGenerateAnimOnly}
          disabled={!aiOk}
          className="btn-ghost w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          title="只生成 AC 后的动画，跳过实时模块进度（适合已经做过的老题）"
        >
          <Play size={12} />
          只生成 AC 动画（老题模式）
        </button>
      </div>
      <div className="text-[10px] text-ink-mute leading-relaxed pt-2">
        生成由"重活"模型完成（默认主云端，可在 Settings 里把 Status / Animation 单独换成 DeepSeek）。
        <br />
        生成期间你可以继续做题，结果会自动出现在这里。
      </div>
    </div>
  );
}

function GeneratingView({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 gap-3 text-[11px] text-ink-mute">
      <Loader2 size={20} className="animate-spin text-accent" />
      <div className="text-ink font-medium">{title}</div>
      {subtitle && <div>{subtitle}</div>}
    </div>
  );
}

function ReadyView({
  problem,
  statusCode,
  animationCode,
  schema,
  moduleStatus,
  isAnimGenerating,
  onRegenerateAnim,
}: {
  problem: Problem;
  statusCode: string | null;
  animationCode: string | null;
  schema: NonNullable<Problem['algoViz']>['detectionSchema'];
  moduleStatus: Record<string, boolean> | undefined;
  isAnimGenerating: boolean;
  onRegenerateAnim: () => void;
}): React.ReactElement {
  // schema → React props 映射：status 模块的 prop 名是 module1/module2/...
  // schema.modules 顺序就是 1/2/3/4，按 id 在 moduleStatus 里查
  const componentProps = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    if (!schema) return out;
    schema.modules.forEach((m, i) => {
      out[`module${i + 1}`] = !!moduleStatus?.[m.id];
    });
    return out;
  }, [schema, moduleStatus]);

  return (
    <div className="px-3 py-3 space-y-4">
      {/* Status 实时区 */}
      {statusCode ? (
        <div className="rounded-lg overflow-hidden border border-line">
          <LLMComponentRenderer
            code={statusCode}
            globals={STATUS_GLOBALS}
            componentProps={componentProps}
          />
        </div>
      ) : (
        <div className="text-[11px] text-ink-mute">（老题模式，没有实时 Status；可直接播放动画）</div>
      )}

      {/* Animation 区 */}
      <div className="border border-line rounded-lg overflow-hidden">
        <div className="px-3 py-2 bg-bg-elev/60 flex items-center gap-2 text-[11px]">
          <Play size={11} className="text-accent" />
          <span className="text-ink font-medium">AC 动画</span>
          <div className="flex-1" />
          <button
            onClick={onRegenerateAnim}
            className="text-ink-mute hover:text-ink transition flex items-center gap-1 text-[10px]"
            title="重新生成动画（重新调一次 Animation 模型）"
            disabled={isAnimGenerating}
          >
            <RefreshCw size={10} className={isAnimGenerating ? 'animate-spin' : ''} />
            重新生成
          </button>
        </div>
        {isAnimGenerating ? (
          <GeneratingView title="生成 Animation 中…" subtitle="预计 60–100 秒" />
        ) : animationCode ? (
          <AnimationPlayer animationCode={animationCode} schema={schema} />
        ) : (
          <div className="px-4 py-6 text-[11px] text-ink-mute text-center">
            动画还没生成，点上面「重新生成」开跑。
          </div>
        )}
      </div>

      {/* 调试信息 */}
      {schema && (
        <details className="text-[10px] text-ink-mute">
          <summary className="cursor-pointer hover:text-ink transition">
            schema 调试信息（{schema.modules.length} 模块）
          </summary>
          <div className="mt-1 font-mono px-2 py-1 bg-bg-elev/50 rounded border border-line/50">
            {schema.modules.map((m, i) => (
              <div key={m.id}>
                <span className="text-accent">module{i + 1}</span> [{m.id}] {m.label} —{' '}
                <span className={moduleStatus?.[m.id] ? 'text-ok' : 'text-ink-mute'}>
                  {moduleStatus?.[m.id] ? '✓ 已完成' : '○ 待完成'}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Animation Player（@remotion/player 包装 + 编译 LLM 代码）
// ──────────────────────────────────────────────────────────────────────

function AnimationPlayer({
  animationCode,
  schema,
}: {
  animationCode: string;
  schema: NonNullable<Problem['algoViz']>['detectionSchema'];
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);

  // 编译一次（hash by code），失败时给错误兜底
  const compiled = useMemo(() => compileLLMComponent(animationCode, REMOTION_GLOBALS), [animationCode]);

  // 全亮 props（AC 后所有模块都应亮）
  const inputProps = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    if (schema) {
      schema.modules.forEach((_, i) => (out[`module${i + 1}`] = true));
    }
    return out;
  }, [schema]);

  if (compiled.error || !compiled.Component) {
    return (
      <div className="px-4 py-6 text-[11px] text-bad break-all">
        Animation 编译失败：{compiled.error ?? '未知错误'}
      </div>
    );
  }

  if (!isOpen) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <button
          onClick={() => setIsOpen(true)}
          className="btn-primary"
          title="点击展开 Remotion Player（首次播放可能需要 1-2 秒载入）"
        >
          <Play size={13} />
          ▶ 播放动画
        </button>
        <div className="text-[10px] text-ink-mute">
          1280×720 · 30fps · 10 秒
        </div>
      </div>
    );
  }

  return (
    <div className="relative bg-black">
      <button
        onClick={() => setIsOpen(false)}
        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-black/60 text-white/80 hover:bg-black/80 flex items-center justify-center"
        title="关闭播放器"
      >
        <X size={12} />
      </button>
      <Player
        component={compiled.Component as React.ComponentType<Record<string, unknown>>}
        durationInFrames={300}
        fps={30}
        compositionWidth={1280}
        compositionHeight={720}
        inputProps={inputProps}
        controls
        autoPlay
        loop
        style={{ width: '100%', height: 'auto', aspectRatio: '16/9' }}
      />
    </div>
  );
}
