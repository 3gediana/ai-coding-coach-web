/**
 * 运行时面板：底部抽屉，跑代码 + 显示 stdout/stderr。
 *
 * - Python：本地 Pyodide
 * - C++/C：远程 wandbox API（首次开发时可能慢）
 * - Markdown / 纯文本：不能跑
 *
 * UI：
 *   - 顶部：运行/停止按钮 + 文件名 + 耗时 + 退出码
 *   - 中部：stdin（左）+ 输出（右）双栏
 *   - 输出彩色：stderr 红，stdout 灰白，编译错误黄
 */
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Square,
  Terminal as TerminalIcon,
  ChevronDown,
  ChevronUp,
  Eraser,
  Loader2,
  Settings as SettingsIcon,
  Sparkles,
  Swords,
} from 'lucide-react';
import { useStore } from '../lib/store';
import { runPython, runCpp, isRuntimeSupported } from '../lib/runtime';
import { cn } from '../lib/cn';
import { toast } from 'sonner';

const DRAFT_SCOPE = '__draft__';

interface OutputLine {
  kind: 'stdout' | 'stderr' | 'system';
  text: string;
}

/** 样例对比：去除行首/尾空白、归一换行，逐行 trim 比较 */
function normalizeSampleText(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t ]+$/g, '').replace(/^\s+/, ''))
    .join('\n')
    .trim();
}

export function RuntimePane() {
  const open = useStore((s) => s.runtimePaneOpen);
  const setOpen = useStore((s) => s.setRuntimePaneOpen);
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);
  const activeProblemId = useStore((s) => s.activeProblemId);
  const problems = useStore((s) => s.problems);
  const setAskPrefill = useStore((s) => s.setAskPrefill);
  const setFeedbackTab = useStore((s) => s.setFeedbackTab);
  const setCoachDraft = useStore((s) => s.setCoachDraft);
  const setLastRun = useStore((s) => s.setLastRun);
  const enqueueHackCase = useStore((s) => s.enqueueHackCase);
  const runHackChain = useStore((s) => s.runHackChain);
  const hackChainRunning = useStore(
    (s) => !!s.hackChainState && !s.hackChainState.result,
  );
  const ollamaMode = useStore((s) => s.aiConfig.ollamaMode);

  const scope = activeProblemId ?? DRAFT_SCOPE;
  const file = (filesByScope[scope] ?? []).find((f) => f.id === activeFileIdByScope[scope]);
  const activeProblem = activeProblemId
    ? problems.find((p) => p.id === activeProblemId)
    : null;

  const [stdin, setStdin] = useState('');

  // 切题时自动用题目的第一个样例输入预填 stdin（仅当用户没自己输入过时）
  // 用户改过 stdin → 不覆盖；切到无样例的题 / 草稿模式 → 也不动
  const lastAutoFilledForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeProblemId) return;
    const sample = activeProblem?.examples?.[0]?.input?.trim();
    if (!sample) return;
    // 只在 stdin 为空 OR 上次自动填的就是它（说明用户没改）时才覆盖
    if (stdin === '' || stdin === lastAutoFilledForRef.current) {
      setStdin(sample);
      lastAutoFilledForRef.current = sample;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProblemId, activeProblem?.examples?.[0]?.input]);
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [duration, setDuration] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

  // hack case 触发去抖：同一文件 30s 内只触发一次主动出题
  const lastHackTriggerRef = useRef<{ fileId: string; ts: number } | null>(null);
  const pendingHackRunRef = useRef(false);

  const outputRef = useRef<HTMLDivElement | null>(null);
  // auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const append = (kind: OutputLine['kind'], text: string) => {
    setOutput((prev) => [...prev, { kind, text }]);
  };

  const onRun = async (forceStdin?: string) => {
    if (!file) return;
    if (!isRuntimeSupported(file.language)) {
      toast.error(`${file.language} 文件不支持运行`);
      return;
    }
    const stdinForRun = forceStdin ?? stdin;
    setRunning(true);
    setOutput([]);
    setDuration(null);
    setExitCode(null);
    append('system', `▶ 运行 ${file.name} ...`);

    try {
      const opts = {
        onStdout: (s: string) => append('stdout', s),
        onStderr: (s: string) => append('stderr', s),
        onProgress: (stage: string) => {
          setProgress(stage);
          if (stage === 'loading-script') append('system', '⏳ 加载 Python 运行时（首次约 5-15s）...');
          if (stage === 'loading-runtime') append('system', '⏳ 启动解释器...');
          if (stage === 'compiling') append('system', '⏳ 远程编译中...');
        },
        timeoutMs: file.language === 'python' ? 15_000 : 30_000,
      };

      let result;
      if (file.language === 'python') {
        result = await runPython(file.content, stdinForRun, opts);
      } else {
        result = await runCpp(file.content, stdinForRun, { ...opts, language: file.language as 'cpp' | 'c' });
      }
      setDuration(result.durationMs);
      setExitCode(result.exitCode);
      append(
        'system',
        `${result.exitCode === 0 ? '✓' : '✗'} 退出码 ${result.exitCode} · 耗时 ${result.durationMs.toFixed(0)}ms`,
      );
      // 把运行快照存到 store，让 analyzeCode 能读取（关键修复！）
      // result.stdout/stderr 是 runtime 累积的全量输出，比 output state 更可靠（state 可能还没 flush）
      setLastRun(scope, {
        fileId: file.id,
        fileName: file.name,
        language: file.language,
        exitCode: result.exitCode,
        stdin: stdinForRun,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        durationMs: result.durationMs,
        timestamp: Date.now(),
      });
      // 运行失败：主动提示用户可以让 AI 帮看
      if (result.exitCode !== 0) {
        toast.error(`运行失败（退出码 ${result.exitCode})`, {
          description: '点终端右上「让 AI 看看错误」按钮，AI 会帮你分析原因',
          duration: 7000,
        });
      }
      // ───── 主动 hack case 触发 ─────
      // 条件：当前样例输入与 examples[0].input 一致，输出与 examples[0].output 一致，
      //       且同 file 30s 内未触发过 hack case，且本次不是由 hack case 自动跑触发的
      const sample = activeProblem?.examples?.[0];
      if (
        result.exitCode === 0 &&
        sample &&
        sample.input.trim() &&
        normalizeSampleText(stdinForRun) === normalizeSampleText(sample.input) &&
        normalizeSampleText(result.stdout || '') === normalizeSampleText(sample.output) &&
        !pendingHackRunRef.current &&
        ollamaMode !== 'disabled'
      ) {
        const last = lastHackTriggerRef.current;
        if (!last || last.fileId !== file.id || Date.now() - last.ts > 30_000) {
          lastHackTriggerRef.current = { fileId: file.id, ts: Date.now() };
          enqueueHackCase({ reason: 'sample-passed' });
        }
      }
      pendingHackRunRef.current = false;
    } catch (e: any) {
      append('stderr', `运行时错误：${e?.message ?? e}`);
      setExitCode(-1);
      pendingHackRunRef.current = false;
      toast.error('运行抛出异常', {
        description: '点终端右上「让 AI 看看错误」按钮，AI 会帮你分析',
        duration: 7000,
      });
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  // 监听 HackCaseCard 触发的 stdin 灌入 + 自动跑事件
  useEffect(() => {
    const onHackRun = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { stdin?: string } | undefined;
      const newStdin = detail?.stdin ?? '';
      if (!newStdin) return;
      setStdin(newStdin);
      pendingHackRunRef.current = true; // 防止本次结果再次触发出 hack
      void onRun(newStdin);
    };
    window.addEventListener('aicc:hack-case-run', onHackRun as EventListener);
    return () => window.removeEventListener('aicc:hack-case-run', onHackRun as EventListener);
    // onRun 闭包里依赖 file/stdin，但每次 effect 重建会 lose 监听 → 忽略 deps，仅挂一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onAskAI = () => {
    if (!file) return;
    setCoachDraft({ source: 'runtime-error' });
    setAskPrefill('帮我看看这次运行错误');
    setFeedbackTab('ask');
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[data-coach-input]')?.focus();
    });
    toast.info('Coach 会自动带上 stderr、stdin 和当前代码');
  };

  const onClear = () => {
    setOutput([]);
    setDuration(null);
    setExitCode(null);
  };

  const supported = file ? isRuntimeSupported(file.language) : false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && supported && file?.content?.trim()) {
        e.preventDefault();
        setOpen(true);
        void onRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, file?.content, stdin]);

  if (!open) {
    // 折叠状态：底部窄条
    return (
      <div className="h-7 border-t border-line bg-bg-elev flex items-center text-xs text-ink-dim w-full">
        <button
          onClick={() => setOpen(true)}
          className="h-full flex-1 hover:bg-bg-elev2 flex items-center gap-2 px-4 text-left"
          title="展开终端"
        >
          <TerminalIcon size={12} />
          <span>终端</span>
          {file && (
            <span className="hidden sm:inline text-[11px] text-ink-mute font-mono">
              {file.name}
            </span>
          )}
          <ChevronUp size={12} className="ml-auto" />
        </button>
        {!running ? (
          <button
            data-runtime-pane-run
            onClick={() => {
              setOpen(true);
              void onRun();
            }}
            className="h-full px-3 border-l border-line hover:bg-bg-elev2 text-accent flex items-center gap-1 font-semibold disabled:text-ink-mute disabled:cursor-not-allowed"
            disabled={!supported || !file?.content?.trim()}
            title={
              !file
                ? '没有活跃文件'
                : !supported
                  ? `${file.language} 文件不能运行`
                  : '运行此文件（Ctrl+Enter）'
            }
          >
            <Play size={12} />
            <span className="hidden sm:inline">运行</span>
          </button>
        ) : (
          <button
            className="h-full px-3 border-l border-line text-bad flex items-center gap-1 font-semibold"
            disabled
            title="运行中"
          >
            <Loader2 size={12} className="animate-spin" />
            <span className="hidden sm:inline">{progress || '运行中'}</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ height: 0 }}
      animate={{ height: 280 }}
      exit={{ height: 0 }}
      className="border-t border-line bg-bg flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="h-9 border-b border-line bg-bg-elev flex items-center px-3 gap-2 shrink-0">
        <TerminalIcon size={13} className="text-ink-dim" />
        <span className="text-xs font-semibold text-ink-dim">终端</span>
        {file && (
          <span className="ml-2 text-[11px] text-ink-mute font-mono">
            {file.name} <span className="text-[10px] uppercase ml-1 opacity-70">{file.language}</span>
          </span>
        )}
        {duration !== null && (
          <span
            className={cn(
              'ml-2 text-[10px] px-1.5 py-0.5 rounded font-mono',
              exitCode === 0 ? 'bg-ok/15 text-ok' : 'bg-bad/15 text-bad',
            )}
          >
            {exitCode === 0 ? '✓' : '✗'} {duration.toFixed(0)}ms
          </span>
        )}

        {/* 失败时显示 Coach 入口 */}
        {exitCode !== null && exitCode !== 0 && !running && (
          <button
            onClick={onAskAI}
            className="ml-2 px-2 py-0.5 text-[11px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/60 transition flex items-center gap-1 font-semibold"
            title="让 Coach 自动结合错误输出、输入和代码分析"
          >
            <Sparkles size={11} />
            问教练
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Hack Chain：4-agent 编排链；与 Ollama 模式无关（LLM 走主云端，Executor 用本地沙箱） */}
          <button
            onClick={() => void runHackChain()}
            disabled={hackChainRunning || !supported || !file?.content?.trim()}
            className={cn(
              'py-1 px-2 text-[11px] rounded border transition flex items-center gap-1 font-semibold',
              !supported || !file?.content?.trim()
                ? 'border-line/40 text-ink-mute cursor-not-allowed'
                : 'border-warn/50 bg-warn/10 text-warn hover:bg-warn/20 hover:border-warn/70',
            )}
            title="4-agent 编排链：Attacker → Executor → Explainer → FixSuggestor"
          >
            {hackChainRunning ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <Swords size={11} />
            )}
            Hack Chain
          </button>
          {!running ? (
            <button
              data-runtime-pane-run
              onClick={() => void onRun()}
              className="btn-primary py-1 text-xs"
              disabled={!supported || !file?.content?.trim()}
              title={
                !file
                  ? '没有活跃文件'
                  : !supported
                    ? `${file.language} 文件不能运行`
                    : '运行此文件（Ctrl+Enter）'
              }
            >
              <Play size={12} />
              运行
            </button>
          ) : (
            <button
              className="btn py-1 text-xs border-bad/60 text-bad hover:bg-bad/10"
              disabled
              title="运行中"
            >
              <Loader2 size={12} className="animate-spin" />
              {progress || '运行中'}
            </button>
          )}
          <button onClick={onClear} className="btn-ghost p-1" title="清空">
            <Eraser size={12} />
          </button>
          <button onClick={() => setOpen(false)} className="btn-ghost p-1" title="收起">
            <ChevronDown size={12} />
          </button>
        </div>
      </div>

      {/* Body：stdin 左 + output 右 */}
      <div className="flex-1 grid grid-cols-[200px_1fr] min-h-0">
        <div className="flex flex-col border-r border-line">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-ink-mute font-semibold border-b border-line/60">
            stdin
          </div>
          <textarea
            value={stdin}
            onChange={(e) => setStdin(e.target.value)}
            placeholder={'每行一个输入，例如:\n5\n1 2 3 4 5'}
            className="flex-1 bg-bg px-2 py-1.5 text-[12px] font-mono text-ink resize-none outline-none placeholder:text-ink-mute"
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col min-w-0">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-ink-mute font-semibold border-b border-line/60">
            output
          </div>
          <div
            ref={outputRef}
            className="flex-1 bg-bg px-3 py-1.5 overflow-y-auto font-mono text-[12px] leading-relaxed"
          >
            {output.length === 0 && (
              <div className="text-ink-mute italic">点 ▶ 运行 让程序跑起来</div>
            )}
            {output.map((line, i) => (
              <pre
                key={i}
                className={cn(
                  'whitespace-pre-wrap break-words',
                  line.kind === 'stdout' && 'text-ink',
                  line.kind === 'stderr' && 'text-bad',
                  line.kind === 'system' && 'text-ink-mute italic',
                )}
              >
                {line.text}
              </pre>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
