import { motion } from 'framer-motion';
import { useEffect } from 'react';
import { Settings, Sparkles, Plus, Play, CheckCircle2, PlayCircle, Library } from 'lucide-react';
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
  const enqueueAnalyze = useStore((s) => s.enqueueAnalyze);
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
          <div className="text-[10px] text-ink-mute leading-none mt-0.5">Web · v0.1</div>
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
          <span className="text-sm text-ink-mute italic">未激活题目</span>
        )}
      </div>

      {/* Active file badge */}
      {activeFile && (
        <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-lg bg-bg-elev2 border border-line">
          <span className="text-[10px] font-mono text-ink-dim uppercase">{activeFile.language}</span>
          <span className="text-xs font-mono text-ink truncate max-w-[140px]">{activeFile.name}</span>
        </div>
      )}

      {/* 题目相关：低频，icon-only ghost（不抢主视觉） */}
      <button onClick={() => setProblemBrowserOpen(true)} className="btn-ghost" title="OJ 题库（洛谷 / AtCoder / POJ / HDU）">
        <Library size={15} />
      </button>
      <button onClick={() => setProblemEditorOpen(true)} className="btn-ghost" title="手动录入 / 贴题面">
        <Plus size={15} />
      </button>

      {/* 分隔线：分组 */}
      <div className="w-px h-5 bg-line/60" />

      {/* 运行：次高频 */}
      <button
        onClick={() => triggerRun(setRuntimePaneOpen)}
        className="btn-ghost"
        disabled={!canRun}
        title={canRun ? '运行 (Ctrl+Enter)' : '当前文件不支持运行'}
      >
        <PlayCircle size={15} />
      </button>

      {/* 主操作：分析代码（唯一 primary，视觉焦点） */}
      <button
        onClick={() => enqueueAnalyze({ reason: 'manual' })}
        className="btn-primary"
        disabled={!canAnalyze}
        title={
          !apiOk
            ? '请先配置 AI'
            : !activeFile
              ? '没有活跃文件'
              : activeFile.language === 'markdown' || activeFile.language === 'plaintext'
                ? '当前文件不是代码（请切到 .cpp/.py）'
                : '触发 AI 分析（异步、流式）'
        }
      >
        <Play size={14} />
        <span className="hidden md:inline">分析代码</span>
        {tasksRunning > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-white/20">
            {tasksRunning}
          </span>
        )}
      </button>

      {activeProblemId && (
        <button
          onClick={() => setSubmitModalOpen(true)}
          className="btn-ghost"
          disabled={!apiOk}
          title="登记提交结果 (AC/WA/TLE/...) → AI 针对性分析"
        >
          <CheckCircle2 size={15} />
        </button>
      )}

      <div className="w-px h-5 bg-line/60" />

      <ThemeSwitcher />

      <button
        onClick={() => setSettingsOpen(true)}
        className={cn(
          'btn-ghost relative',
          !apiOk && '!text-warn hover:!text-warn',
        )}
        title={apiOk ? 'AI 设置' : 'AI 未配置 — 点击配置'}
      >
        <Settings size={14} />
        {!apiOk && (
          <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-warn animate-pulseGlow" />
        )}
      </button>
    </header>
  );
}
