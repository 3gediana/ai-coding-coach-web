import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import {
  Settings,
  Sparkles,
  Plus,
  CheckCircle2,
  PlayCircle,
  Library,
  MessageCircleQuestion,
  Brain,
  WifiOff,
  Plane,
  ChevronDown,
} from 'lucide-react';
import { useOnlineStatus, setForcedOffline } from '../lib/offlineMode';
import { toast } from 'sonner';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { isRuntimeSupported } from '../lib/runtime';
import { ThemeSwitcher } from './ThemeSwitcher';

/** 展开终端 + 触发 RuntimePane 内的运行按钮 */
function triggerRun(setOpen: (v: boolean) => void) {
  setOpen(true);
  // RuntimePane 动画 280ms，等它挂载
  setTimeout(() => {
    const btn = document.querySelector(
      '[data-runtime-pane-run]',
    ) as HTMLButtonElement | null;
    btn?.click();
  }, 350);
}

export function TopBar() {
  const aiConfig = useStore((s) => s.aiConfig);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setProblemEditorOpen = useStore((s) => s.setProblemEditorOpen);
  const setProblemBrowserOpen = useStore((s) => s.setProblemBrowserOpen);
  const setCmdPaletteOpen = useStore((s) => s.setCmdPaletteOpen);
  const setSubmitModalOpen = useStore((s) => s.setSubmitModalOpen);
  const setRuntimePaneOpen = useStore((s) => s.setRuntimePaneOpen);
  const setAskPrefill = useStore((s) => s.setAskPrefill);
  const setCoachDraft = useStore((s) => s.setCoachDraft);
  const setFeedbackTab = useStore((s) => s.setFeedbackTab);
  const askCoach = useStore((s) => s.askCoach);
  const onboardingStep = useStore((s) => s.onboardingStep);
  const activeProblemId = useStore((s) => s.activeProblemId);
  const problems = useStore((s) => s.problems);
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);
  const tasksRunning = useStore((s) =>
    s.tasks.filter((t) => t.status === 'running' || t.status === 'queued').length,
  );

  const activeProblem = activeProblemId ? problems.find((p) => p.id === activeProblemId) : null;
  // ollama 等本地服务不需要 apiKey；其它都要
  const apiOk = aiConfig.provider === 'ollama' ? !!aiConfig.baseUrl : !!aiConfig.apiKey;
  const scope = activeProblemId ?? '__draft__';
  const activeFile = (filesByScope[scope] ?? []).find(
    (f) => f.id === activeFileIdByScope[scope],
  );
  const canAnalyze =
    apiOk &&
    activeFile &&
    (activeFile.language === 'cpp' || activeFile.language === 'c' || activeFile.language === 'python');
  const canRun = activeFile && isRuntimeSupported(activeFile.language);
  const openCoach = () => {
    setFeedbackTab('ask');
    setCoachDraft({ source: 'topbar' });
    // Onboarding wait-analyze：直接发起一次代码审查，不让新用户卡在 "该问什么"
    if (onboardingStep === 'wait-analyze' && activeFile) {
      void askCoach({ text: '帮我看看我的代码哪里错了', source: 'topbar' });
      return;
    }
    setAskPrefill(activeFile ? '帮我看看我现在应该注意什么' : '我现在有点卡住了，帮我理一下');
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[data-coach-input]')?.focus();
    });
  };

  // Ctrl+Enter 全局：展开终端 + 触发运行
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun) {
        e.preventDefault();
        triggerRun(setRuntimePaneOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canRun, setRuntimePaneOpen]);

  return (
    <header className="glass border-b border-line h-14 flex items-center px-4 gap-3 z-30">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-2">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-cyan flex items-center justify-center shadow-glow">
          <Sparkles size={18} className="text-bg" strokeWidth={2.5} />
        </div>
        <div className="hidden sm:block">
          <div className="text-sm font-bold leading-none">AI Coding Coach</div>
        </div>
      </div>

      {/* Active problem badge */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        {activeProblem ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-bg-elev2 border border-accent/30 max-w-[480px]"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulseGlow" />
            <span className="text-sm font-medium text-ink truncate">{activeProblem.title}</span>
            {activeProblem.difficulty && (
              <span
                className={cn(
                  'chip text-[10px]',
                  activeProblem.difficulty === 'easy' && 'chip-ok',
                  activeProblem.difficulty === 'medium' && 'chip-warn',
                  activeProblem.difficulty === 'hard' && 'chip-bad',
                )}
              >
                {activeProblem.difficulty}
              </span>
            )}
          </motion.div>
        ) : (
          <span className="text-sm text-ink-mute">
            还没激活题目 · 从右上角
            <span className="mx-1 px-1.5 py-0.5 rounded bg-bg-elev2 border border-line text-[11px] text-ink">题目 ▾</span>
            录入或选一道
          </span>
        )}
      </div>

      {/* Offline / Airplane chip */}
      <OfflineChip />

      {/* Active file badge */}
      {activeFile && (
        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-elev2 border border-line">
          <span className="text-[10px] font-mono text-ink-dim uppercase">{activeFile.language}</span>
          <span className="text-xs font-mono text-ink truncate max-w-[140px]">{activeFile.name}</span>
        </div>
      )}

      {/* 运行：次高频 */}
      <button
        onClick={() => triggerRun(setRuntimePaneOpen)}
        className="btn-ghost"
        disabled={!canRun}
        title={canRun ? '运行 (Ctrl+Enter)' : '当前文件不支持运行'}
      >
        <PlayCircle size={15} />
      </button>

      <button
        data-onboarding="analyze"
        onClick={openCoach}
        className="btn-primary"
        disabled={!apiOk}
        title={
          !apiOk
            ? '请先配置 AI（点右上角齿轮）'
            : activeProblem
            ? '问 Coach：题意 / 思路 / 报错 / 代码 都行'
            : '没题也能问：学习方向 / 配置 / 算法概念都行'
        }
      >
        <MessageCircleQuestion size={14} />
        <span className="hidden md:inline">问教练</span>
        {tasksRunning > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-white/20">
            {tasksRunning}
          </span>
        )}
      </button>

      {/* 题目操作：下拉折叠（题库 / 录题 / 提交 / 费曼） */}
      <ProblemMenu
        apiOk={apiOk}
        hasActiveProblem={!!activeProblemId}
        onOpenBrowser={() => setProblemBrowserOpen(true)}
        onOpenEditor={() => setProblemEditorOpen(true)}
        onOpenSubmit={() => setSubmitModalOpen(true)}
        onOpenFeynman={() => useStore.getState().openFeynman()}
      />

      <div className="w-px h-5 bg-line/60" />

      <ThemeSwitcher />

      <button
        onClick={() => setSettingsOpen(true)}
        className={cn(
          'relative',
          apiOk
            ? 'btn-ghost'
            : 'btn border-warn/50 bg-warn/10 text-warn hover:bg-warn/15 hover:border-warn/70',
        )}
        title={apiOk ? 'AI 设置' : 'AI 未配置 — 点击配置'}
      >
        <Settings size={14} />
        {!apiOk && <span className="hidden md:inline text-xs font-semibold">配置 AI</span>}
        {!apiOk && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-warn animate-pulseGlow" />
        )}
      </button>
    </header>
  );
}

/**
 * 在线状态 chip：常态 hidden、离线/飞行模式 时浮现，
 * 点击切换"飞行模式"（手动模拟拔网线）。
 *
 * 演示价值：评委录像时点这个 chip → 立刻看见 AI 路由切到本地，1B 模型完整可用。
 */
function OfflineChip() {
  const status = useOnlineStatus();
  const aiConfig = useStore((s) => s.aiConfig);
  // FastLane 是否可用（决定离线时还能不能干活）
  const fastUsable =
    !!aiConfig.fastLane?.enabled &&
    !!aiConfig.fastLane?.baseUrl &&
    !!aiConfig.fastLane?.model;

  if (status === 'online') {
    // 在线时：fastLane 启用 → 显一个明显的 ⚡ Local chip；未启用 → 只挂隐藏的「飞行模式」入口
    return (
      <div className="hidden md:flex items-center gap-1">
        {fastUsable && (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-ok/10 border border-ok/30 text-[10px] font-medium text-ok"
            title="本地 FastLane (Ollama) 已启用·实时类任务零成本走本地"
          >
            ⚡ Local
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            if (!fastUsable) {
              toast.warning('飞行模式需要先配本地 FastLane (Ollama)');
              return;
            }
            setForcedOffline(true);
            toast.success('已进入飞行模式 · AI 全部走本地');
          }}
          className="flex items-center text-[10px] text-ink-mute hover:text-warn transition px-1.5 py-0.5 rounded opacity-40 hover:opacity-100"
          title="模拟拔网线 / 飞行模式 — AI 强制走本地"
        >
          <Plane size={11} />
        </button>
      </div>
    );
  }

  const isForced = status === 'forced-offline';
  return (
    <motion.button
      type="button"
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      onClick={() => {
        if (isForced) {
          setForcedOffline(false);
          toast.success('已退出飞行模式');
        } else {
          toast.message('网络已断开 · AI 自动切到本地 FastLane', {
            description: fastUsable
              ? '本地 sam:latest 在线，可继续批注 / 总结 / 问答'
              : '⚠ 没配 FastLane，云端任务会失败',
          });
        }
      }}
      className={cn(
        'flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold transition',
        isForced
          ? 'border-warn/60 bg-warn/15 text-warn'
          : 'border-bad/60 bg-bad/15 text-bad',
        !fastUsable && 'animate-pulse',
      )}
      title={
        isForced
          ? '飞行模式中 · 点击退出'
          : '检测到无网络 · 已切到本地 FastLane'
      }
    >
      {isForced ? <Plane size={11} /> : <WifiOff size={11} />}
      <span className="hidden sm:inline">
        {isForced ? '飞行模式' : '离线'}
      </span>
      {fastUsable && <span className="text-[9px] opacity-80">⚡ 本地</span>}
    </motion.button>
  );
}

/**
 * 题目操作下拉菜单：把"题库 / 录题 / 提交 / 费曼"4 个低频按钮折叠成一个入口，
 * 减少 TopBar 视觉噪音。提交 / 费曼 仅在有 activeProblem 时启用。
 */
function ProblemMenu({
  apiOk,
  hasActiveProblem,
  onOpenBrowser,
  onOpenEditor,
  onOpenSubmit,
  onOpenFeynman,
}: {
  apiOk: boolean;
  hasActiveProblem: boolean;
  onOpenBrowser: () => void;
  onOpenEditor: () => void;
  onOpenSubmit: () => void;
  onOpenFeynman: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const items: Array<{
    icon: typeof Library;
    label: string;
    desc: string;
    onClick: () => void;
    disabled?: boolean;
    accent?: boolean;
  }> = [
    {
      icon: Library,
      label: '题库',
      desc: 'OJ 题库（洛谷 / AtCoder / POJ / HDU）',
      onClick: onOpenBrowser,
    },
    {
      icon: Plus,
      label: '录入题目',
      desc: '手动录入 / 贴题面',
      onClick: onOpenEditor,
    },
    {
      icon: CheckCircle2,
      label: '登记提交',
      desc: 'AC/WA/TLE/... → AI 针对性分析',
      onClick: onOpenSubmit,
      disabled: !hasActiveProblem || !apiOk,
    },
    {
      icon: Brain,
      label: '费曼模式',
      desc: '用你的话给 AI 讲题，AI 装菜鸟提问',
      onClick: onOpenFeynman,
      disabled: !hasActiveProblem || !apiOk,
      accent: true,
    },
  ];

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn('btn-ghost', open && 'bg-bg-elev2')}
        title="题目操作（题库 / 录入 / 提交 / 费曼）"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Library size={15} />
        <span className="hidden md:inline text-[12px]">题目</span>
        <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            role="menu"
            className="absolute right-0 mt-1 w-64 z-50 rounded-xl border border-line bg-bg-elev shadow-2xl overflow-hidden"
          >
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if (it.disabled) return;
                    setOpen(false);
                    it.onClick();
                  }}
                  disabled={it.disabled}
                  title={
                    it.disabled
                      ? !apiOk
                        ? '需先配置 AI（右上角齿轮）'
                        : '需先激活一道题'
                      : it.desc
                  }
                  className={cn(
                    'w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-line/40 last:border-b-0',
                    it.disabled
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-bg-elev2 cursor-pointer',
                  )}
                >
                  <Icon
                    size={15}
                    className={cn(
                      'shrink-0 mt-0.5',
                      it.accent ? 'text-purple-400' : 'text-ink-dim',
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-ink leading-tight">
                      {it.label}
                    </div>
                    <div className="text-[10.5px] text-ink-mute mt-0.5 leading-snug">
                      {it.desc}
                    </div>
                  </div>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
