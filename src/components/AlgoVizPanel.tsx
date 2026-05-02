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
import { useMemo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Loader2,
  Play,
  RefreshCw,
  AlertTriangle,
  Sparkles,
  X,
  CheckCircle2,
  Circle,
  Film,
  Layers3,
  Radio,
  Wand2,
} from 'lucide-react';
import { Player, type PlayerRef } from '@remotion/player';
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

type AlgoVizSchema = NonNullable<NonNullable<Problem['algoViz']>['detectionSchema']>;

export function AlgoVizPanel(): React.ReactElement {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const problem = useStore((s) =>
    activeProblemId ? s.problems.find((p) => p.id === activeProblemId) ?? null : null,
  );
  const moduleStatus = useStore((s) =>
    activeProblemId ? s.moduleStatusByProblem[activeProblemId] : undefined,
  );
  const activeFileContent = useStore((s) => {
    if (!activeProblemId) return '';
    const fileId = s.activeFileIdByScope[activeProblemId];
    return (s.filesByScope[activeProblemId] ?? []).find((f) => f.id === fileId)?.content ?? '';
  });
  const detecting = useStore((s) =>
    activeProblemId ? !!s.algoVizDetectingByProblem[activeProblemId] : false,
  );
  const requestGen = useStore((s) => s.requestAlgoVizGeneration);
  const requestAnimOnly = useStore((s) => s.requestAlgoVizAnimationOnly);
  const showRealtimeStatus = useStore((s) => s.aiConfig.ollamaMode !== 'disabled');

  if (!problem) {
    return (
      <div className="flex-1 p-3 flex items-center justify-center">
        <div className="w-full rounded-md border border-line bg-bg-card px-4 py-6 text-center shadow-soft">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
            <Wand2 size={18} />
          </div>
          <div className="text-sm font-semibold text-ink">算法可视化</div>
          <div className="mt-1 text-[11px] leading-relaxed text-ink-mute">
            激活一道题后，这里会展示代码进度脚手架、模块亮灯和 AI 生成的算法动画。
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            <span className="chip-accent">14 套模板</span>
            <span className="chip">实时检测</span>
            <span className="chip">Remotion 动画</span>
          </div>
        </div>
      </div>
    );
  }

  const algoViz = problem.algoViz;
  const status = algoViz?.status ?? 'idle';
  const statusCode = algoViz?.statusCode ?? null;
  const animationCode = algoViz?.animationCode ?? null;
  const schema = algoViz?.detectionSchema ?? null;

  // ★ 即使 failed，只要有旧的 statusCode 就让用户继续看/播放上一次的版本，
  //   不要把已生成好的内容因为这次"重新生成失败"而隐藏掉。
  const hasUsable = showRealtimeStatus ? !!statusCode : !!(statusCode || animationCode);
  const showIdle = status === 'idle' || (status === 'failed' && !hasUsable);
  const showGeneratingStatus = status === 'generating-status' && !hasUsable;
  const showReady =
    status === 'status-ready' ||
    status === 'generating-anim' ||
    status === 'ready' ||
    (status === 'failed' && hasUsable) ||
    (status === 'generating-status' && hasUsable);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <HeaderBar
        algoName={schema?.algoName}
        status={status}
        detecting={showRealtimeStatus && detecting}
        errorMessage={algoViz?.errorMessage}
        showRealtimeStatus={showRealtimeStatus}
      />
      <div className="flex-1 overflow-y-auto">
        {/* failed 状态但有旧产物：顶部一条小 banner 提示重生失败、保留旧版本 */}
        {status === 'failed' && hasUsable && algoViz?.errorMessage && (
          <div className="mx-3 mt-2 px-2.5 py-1.5 rounded border border-warn/40 bg-warn/10 text-[11px] text-warn flex items-center gap-2">
            <AlertTriangle size={13} />
            <span className="flex-1 truncate" title={algoViz.errorMessage}>
              重新生成失败，已保留之前版本
            </span>
            <button
              className="text-[11px] underline hover:no-underline"
              onClick={() => void requestAnimOnly(problem.id)}
            >
              重试
            </button>
          </div>
        )}

        {showIdle && (
          <IdleOrFailedView
            problem={problem}
            errorMessage={algoViz?.errorMessage}
            onGenerateFull={() => void requestGen(problem.id, { force: status === 'failed' })}
            onGenerateAnimOnly={() => void requestAnimOnly(problem.id)}
            showRealtimeStatus={showRealtimeStatus}
          />
        )}

        {showGeneratingStatus && (
          <GeneratingView
            title={showRealtimeStatus ? '生成 Status 模块卡片中…' : '准备动画素材中…'}
            subtitle="预计 ~20 秒"
          />
        )}

        {showReady && (
          <ReadyView
            problem={problem}
            statusCode={statusCode}
            animationCode={animationCode}
            schema={schema}
            moduleStatus={moduleStatus}
            detecting={showRealtimeStatus && detecting}
            hasUserCode={!!activeFileContent.trim()}
            isAnimGenerating={
              status === 'status-ready' || status === 'generating-anim' || status === 'generating-status'
            }
            onRegenerateAnim={() => void requestAnimOnly(problem.id)}
            showRealtimeStatus={showRealtimeStatus}
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
  showRealtimeStatus,
}: {
  algoName?: string;
  status: NonNullable<Problem['algoViz']>['status'];
  detecting: boolean;
  errorMessage?: string;
  showRealtimeStatus: boolean;
}): React.ReactElement {
  const label = (() => {
    switch (status) {
      case 'idle':
        return '未生成';
      case 'generating-status':
        return showRealtimeStatus ? '生成 Status…' : '准备动画素材…';
      case 'status-ready':
        return showRealtimeStatus ? 'Status 就绪 · 准备动画中' : '准备动画中…';
      case 'generating-anim':
        return 'Animation 生成中…';
      case 'ready':
        return showRealtimeStatus ? '就绪' : '动画就绪';
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
  showRealtimeStatus,
}: {
  problem: Problem;
  errorMessage?: string;
  onGenerateFull: () => void;
  onGenerateAnimOnly: () => void;
  showRealtimeStatus: boolean;
}): React.ReactElement {
  const aiOk = useStore((s) => {
    const cfg = s.aiConfig;
    return cfg.provider === 'ollama'
      ? cfg.ollamaMode !== 'disabled' && !!cfg.baseUrl
      : !!cfg.apiKey;
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
      <div className="rounded-md border border-line bg-bg-card px-3 py-3 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-xl border border-accent/30 bg-accent/10 flex items-center justify-center text-accent">
            <Film size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-ink">一键生成可讲解动画</div>
            <div className="mt-1 text-[10.5px] leading-relaxed text-ink-mute">
              先抽取算法轨迹，再生成实时模块脚手架，最后合成可播放的 Remotion 动画。
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <span className="chip-accent">14 套模板路由</span>
              <span className="chip">模块亮灯</span>
              <span className="chip">后台生成</span>
            </div>
          </div>
        </div>
      </div>
      <div className="space-y-2">
        <button
          onClick={onGenerateFull}
          disabled={!aiOk}
          className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          title={
            showRealtimeStatus
              ? '生成模块进度卡片 + AC 动画（耗时约 90-120 秒，后台进行不阻塞做题）'
              : '生成 AC 动画（耗时约 90-120 秒，后台进行不阻塞做题）'
          }
        >
          <Sparkles size={13} />
          {showRealtimeStatus
            ? failed ? '重新生成全套（Status + Animation）' : '生成 Status + Animation（推荐）'
            : failed ? '重新生成算法动画' : '生成算法动画'}
        </button>
        {showRealtimeStatus && (
          <button
            onClick={onGenerateAnimOnly}
            disabled={!aiOk}
            className="btn-ghost w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
            title="只生成 AC 后的动画，跳过实时模块进度（适合已经做过的老题）"
          >
            <Play size={12} />
            只生成 AC 动画（老题模式）
          </button>
        )}
      </div>
      <div className="text-[10px] text-ink-mute leading-relaxed pt-2">
        生成由"重活"模型完成（默认主云端，可在 Settings 里单独换成 DeepSeek）。
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
    <div className="px-4 py-8">
      <div className="rounded-md border border-line bg-bg-card p-4 text-center shadow-soft">
        <div className="relative mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-accent/35 bg-accent/10 text-accent">
          <Loader2 size={20} className="animate-spin" />
        </div>
        <div className="relative text-sm font-semibold text-ink">{title}</div>
        {subtitle && <div className="relative mt-1 text-[11px] text-ink-mute">{subtitle}</div>}
        <div className="relative mt-4 grid grid-cols-3 gap-1.5 text-[10px]">
          <div className="rounded-lg border border-accent/35 bg-accent/10 px-2 py-1.5 text-accent">
            Trace
          </div>
          <div className="rounded-lg border border-cyan/35 bg-cyan/10 px-2 py-1.5 text-cyan">
            Status
          </div>
          <div className="rounded-lg border border-line bg-bg-elev/60 px-2 py-1.5 text-ink-dim">
            Animation
          </div>
        </div>
      </div>
    </div>
  );
}

function AlgoVizSummaryCard({
  problemTitle,
  algoName,
  completedCount,
  totalCount,
  progressPercent,
  detecting,
  isAnimGenerating,
  hasAnimation,
  showRealtimeStatus,
}: {
  problemTitle: string;
  algoName?: string;
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  detecting: boolean;
  isAnimGenerating: boolean;
  hasAnimation: boolean;
  showRealtimeStatus: boolean;
}): React.ReactElement {
  const statusLabel = hasAnimation
    ? '动画就绪'
    : isAnimGenerating
      ? '制作动画中'
      : showRealtimeStatus
        ? '脚手架同步中'
        : '动画模式';
  return (
    <div className="rounded-md border border-line bg-bg-card shadow-soft">
      <div className="relative p-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-2xl border border-accent/35 bg-accent/10 flex items-center justify-center text-accent shadow-soft">
            <Wand2 size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-mute">
              <Sparkles size={10} className="text-accent" />
              算法可视化
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-ink" title={problemTitle}>
              {problemTitle}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {algoName && <span className="chip-accent font-mono">{algoName}</span>}
              <span className={hasAnimation ? 'chip-ok' : isAnimGenerating ? 'chip-warn' : 'chip'}>
                <Film size={10} />
                {statusLabel}
              </span>
              {showRealtimeStatus && (
                <span className={detecting ? 'chip-accent' : 'chip'}>
                  <Radio size={10} className={detecting ? 'animate-pulse' : ''} />
                  {detecting ? '检测中' : '实时检测'}
                </span>
              )}
            </div>
          </div>
          {showRealtimeStatus && totalCount > 0 && (
            <div className="text-right shrink-0">
              <div className="font-mono text-lg font-semibold text-accent">{progressPercent}%</div>
              <div className="text-[10px] text-ink-mute">
                {completedCount}/{totalCount} 模块
              </div>
            </div>
          )}
        </div>
        {showRealtimeStatus && totalCount > 0 && (
          <div className="mt-3 h-1.5 rounded-full bg-bg-elev2/70 overflow-hidden border border-line/40">
            <div
              className="h-full rounded-full bg-accent transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ModuleProgressRail({
  schema,
  moduleStatus,
  detecting,
}: {
  schema: AlgoVizSchema;
  moduleStatus: Record<string, boolean> | undefined;
  detecting: boolean;
}): React.ReactElement {
  return (
    <div className="rounded-xl border border-line/60 bg-bg-card/80 shadow-soft overflow-hidden">
      <div className="px-3 py-1.5 flex items-center gap-2 border-b border-line/50 bg-bg-elev/35 text-[11px]">
        <Layers3 size={12} className="text-accent" />
        <span className="font-medium text-ink">代码进度脚手架</span>
        <span className="text-ink-mute">按你写代码的模块顺序点亮</span>
        <div className="flex-1" />
        {detecting && <Loader2 size={11} className="animate-spin text-accent" />}
      </div>
      <div className="p-2 grid gap-1.5">
        {schema.modules.map((m, i) => {
          const done = !!moduleStatus?.[m.id];
          return (
            <div
              key={m.id}
              className={[
                'relative overflow-hidden rounded-lg border px-2.5 py-2 transition',
                done
                  ? 'border-ok/45 bg-ok/10 text-ink'
                  : 'border-line/70 bg-bg-elev/35 text-ink-dim',
              ].join(' ')}
            >
              <div className="flex items-start gap-2">
                <div
                  className={[
                    'mt-0.5 h-5 w-5 rounded-full border flex items-center justify-center shrink-0',
                    done ? 'border-ok bg-ok/15 text-ok' : 'border-line-strong/60 text-ink-mute',
                  ].join(' ')}
                >
                  {done ? <CheckCircle2 size={13} /> : <Circle size={12} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-ink-mute">M{i + 1}</span>
                    <span className={done ? 'text-ok' : 'text-ink'}>{m.label}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-mute truncate" title={m.description}>
                    {m.description}
                  </div>
                </div>
                <span className={done ? 'chip-ok' : 'chip'}>{done ? '已点亮' : '待出现'}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReadyView({
  problem,
  statusCode,
  animationCode,
  schema,
  moduleStatus,
  detecting,
  hasUserCode,
  isAnimGenerating,
  onRegenerateAnim,
  showRealtimeStatus,
}: {
  problem: Problem;
  statusCode: string | null;
  animationCode: string | null;
  schema: NonNullable<Problem['algoViz']>['detectionSchema'];
  moduleStatus: Record<string, boolean> | undefined;
  detecting: boolean;
  hasUserCode: boolean;
  isAnimGenerating: boolean;
  onRegenerateAnim: () => void;
  showRealtimeStatus: boolean;
}) {
  const effectiveModuleStatus = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    if (!schema) return out;
    schema.modules.forEach((m) => {
      out[m.id] = hasUserCode ? !!moduleStatus?.[m.id] : false;
    });
    return out;
  }, [schema, moduleStatus, hasUserCode]);

  // schema → React props 映射：status 模块的 prop 名是 module1/module2/...
  // schema.modules 顺序就是 1/2/3/4，按 id 在 moduleStatus 里查
  const componentProps = useMemo<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {};
    if (!schema) return out;
    schema.modules.forEach((m, i) => {
      out[`module${i + 1}`] = !!effectiveModuleStatus[m.id];
    });
    return out;
  }, [schema, effectiveModuleStatus]);
  const modules = schema?.modules ?? [];
  const completedCount = modules.filter((m) => !!effectiveModuleStatus[m.id]).length;
  const progressPercent = modules.length > 0 ? Math.round((completedCount / modules.length) * 100) : 0;
  const hasRealtimeStatus = showRealtimeStatus && !!statusCode;

  return (
    <div className="px-2 py-2 space-y-3">
      <AlgoVizSummaryCard
        problemTitle={problem.title}
        algoName={schema?.algoName}
        completedCount={completedCount}
        totalCount={modules.length}
        progressPercent={progressPercent}
        detecting={detecting}
        isAnimGenerating={isAnimGenerating}
        hasAnimation={!!animationCode}
        showRealtimeStatus={hasRealtimeStatus}
      />

      {hasRealtimeStatus && schema && (
        <ModuleProgressRail
          schema={schema}
          moduleStatus={effectiveModuleStatus}
          detecting={detecting}
        />
      )}

      {hasRealtimeStatus && statusCode && schema ? (
        <div className="relative overflow-hidden rounded-md border border-line/60 bg-bg-card shadow-soft">
          <div className="relative px-3 py-1.5 flex items-center gap-2 border-b border-line/50 bg-bg-elev/35 text-[11px]">
            <Layers3 size={12} className="text-accent" />
            <span className="font-medium text-ink">实时算法脚手架</span>
            <span className="text-ink-mute">代码模块点亮后，下方视觉骨架会同步变化</span>
          </div>
          <div className="relative p-2">
            {hasUserCode ? (
              <LLMComponentRenderer
                code={statusCode}
                globals={STATUS_GLOBALS}
                componentProps={componentProps}
              />
            ) : (
              <EmptyStatusPlaceholder schema={schema} />
            )}
          </div>
        </div>
      ) : showRealtimeStatus ? (
        <div className="text-[11px] text-ink-mute px-2">（老题模式，没有实时 Status；可直接播放动画）</div>
      ) : null}

      <div className="border border-line/60 rounded-md overflow-hidden bg-bg-card shadow-soft">
        <div className="px-3 py-2 flex items-center gap-2 text-[11px] bg-bg-elev/40">
          <Film size={12} className="text-accent" />
          <span className="text-ink font-medium">算法动画</span>
          <span className="chip-accent">1280×720</span>
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
        ) : animationCode && schema ? (
          <AnimationPlayer animationCode={animationCode} schema={schema} />
        ) : (
          <div className="px-4 py-6 text-[11px] text-ink-mute text-center">
            动画还没生成，点上面「重新生成」开跑。
          </div>
        )}
      </div>

      {hasRealtimeStatus && schema && (
        <details className="text-[10px] text-ink-mute">
          <summary className="cursor-pointer hover:text-ink transition">
            代码模块检测状态（{schema.modules.length} 模块）
          </summary>
          <div className="mt-1 font-mono px-2 py-1 bg-bg-elev/50 rounded border border-line/50">
            <div className="mb-1 text-[10px] text-ink-mute font-sans">
              实时检测结果会随当前代码重新计算，刷新页面后会重新检测。
            </div>
            {schema.modules.map((m, i) => (
              <div key={m.id}>
                <span className="text-accent">module{i + 1}</span> [{m.id}] {m.label} —{' '}
                <span className={effectiveModuleStatus[m.id] ? 'text-ok' : 'text-ink-mute'}>
                  {effectiveModuleStatus[m.id] ? '✓ 代码已出现' : '○ 待在代码中出现'}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function EmptyStatusPlaceholder({
  schema,
}: {
  schema: AlgoVizSchema;
}): React.ReactElement {
  return (
    <div className="rounded-lg border border-dashed border-line-strong/70 bg-bg-elev/30 px-3 py-4 text-[11px] text-ink-mute">
      <div className="font-medium text-ink mb-2">还没有代码，实时脚手架保持全灭</div>
      <div className="grid gap-1.5">
        {schema.modules.map((m, i) => (
          <div key={m.id} className="flex items-center gap-2 rounded border border-line/60 bg-bg-card/60 px-2 py-1.5">
            <Circle size={11} className="text-ink-mute shrink-0" />
            <span className="font-mono text-[10px] text-ink-mute">M{i + 1}</span>
            <span className="text-ink-dim">{m.label}</span>
            <span className="ml-auto chip">待出现</span>
          </div>
        ))}
      </div>
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
  const playerRef = useRef<PlayerRef>(null);

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

  // ESC 关闭模态（hooks 必须在 early-return 之前声明，保证调用顺序稳定）
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => {
      try {
        playerRef.current?.seekTo(0);
        playerRef.current?.play();
      } catch {
        void 0;
      }
    }, 80);
    return () => window.clearTimeout(timer);
  }, [isOpen, animationCode]);

  if (compiled.error || !compiled.Component) {
    return (
      <div className="px-4 py-6 text-[11px] text-bad break-all">
        Animation 编译失败：{compiled.error ?? '未知错误'}
      </div>
    );
  }

  return (
    <>
      {/* panel 内：仅一个播放按钮（不再内嵌 Player，避免占据 panel 空间） */}
      <div className="flex flex-col items-center justify-center py-8 gap-3 bg-bg-card">
        <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/35 bg-accent/10 text-accent shadow-soft">
          <Play size={24} />
        </div>
        <button
          onClick={() => setIsOpen(true)}
          className="btn-primary relative"
          title="点击展开播放器（弹出大窗口）"
        >
          <Play size={13} />
          播放动画
        </button>
        <div className="relative flex flex-wrap justify-center gap-1.5 text-[10px] text-ink-mute">
          <span className="chip">Remotion Player</span>
          <span className="chip">自动循环</span>
          <span className="chip">10 秒讲解动画</span>
        </div>
      </div>

      {/* 模态框：fixed 居中 + 米黄半透明遮罩 + ~75% 屏幕 + 透明 Player 背景 */}
      {isOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center modal-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsOpen(false);
            }}
          >
            <div
              className="relative shadow-soft rounded-lg border border-line bg-bg-card"
              style={{
                width: 'min(75vw, calc(75vh * 16/9))',
                aspectRatio: '16/9',
              }}
            >
              <div className="absolute inset-x-0 top-0 z-10 h-9 px-3 flex items-center gap-2 text-[11px] text-ink bg-bg-card/95 border-b border-line/40">
                <Film size={12} className="text-accent" />
                <span className="font-medium">算法动画</span>
                <span className="text-ink-mute">1280×720 · loop</span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="absolute top-2 right-2 z-30 w-8 h-8 rounded-full bg-bg/95 shadow-md border border-line text-ink-mute hover:text-ink hover:border-ink-mute transition flex items-center justify-center"
                title="关闭（Esc）"
              >
                <X size={14} />
              </button>
              <div className="h-full w-full overflow-hidden rounded-lg">
                <Player
                  key={animationCode}
                  ref={playerRef}
                  component={compiled.Component as React.ComponentType<Record<string, unknown>>}
                  durationInFrames={300}
                  fps={30}
                  compositionWidth={1280}
                  compositionHeight={720}
                  inputProps={inputProps}
                  controls
                  autoPlay
                  loop
                  clickToPlay
                  initiallyMuted
                  overflowVisible
                  acknowledgeRemotionLicense
                  style={{ width: '100%', height: '100%', backgroundColor: 'transparent' }}
                />
              </div>
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11px] text-ink-mute">
              点空白处或按 Esc 关闭
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
