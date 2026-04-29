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

export function RuntimePane() {
  const open = useStore((s) => s.runtimePaneOpen);
  const setOpen = useStore((s) => s.setRuntimePaneOpen);
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);
  const activeProblemId = useStore((s) => s.activeProblemId);
  const setAskPrefill = useStore((s) => s.setAskPrefill);
  const setFeedbackTab = useStore((s) => s.setFeedbackTab);
  const setLastRun = useStore((s) => s.setLastRun);

  const scope = activeProblemId ?? DRAFT_SCOPE;
  const file = (filesByScope[scope] ?? []).find((f) => f.id === activeFileIdByScope[scope]);

  const [stdin, setStdin] = useState('');
  const [output, setOutput] = useState<OutputLine[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string>('');
  const [duration, setDuration] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);

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

  const onRun = async () => {
    if (!file) return;
    if (!isRuntimeSupported(file.language)) {
      toast.error(`${file.language} 文件不支持运行`);
      return;
    }
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
        result = await runPython(file.content, stdin, opts);
      } else {
        result = await runCpp(file.content, stdin, { ...opts, language: file.language as 'cpp' | 'c' });
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
        stdin,
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
    } catch (e: any) {
      append('stderr', `运行时错误：${e?.message ?? e}`);
      setExitCode(-1);
      toast.error('运行抛出异常', {
        description: '点终端右上「让 AI 看看错误」按钮，AI 会帮你分析',
        duration: 7000,
      });
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const onAskAI = () => {
    if (!file) return;
    // 收集 stderr + system 输出（运行失败的关键信息）
    const errorLines = output
      .filter((l) => l.kind === 'stderr' || l.kind === 'system')
      .map((l) => l.text)
      .join('\n')
      .slice(-2000); // 只保留最后 2000 字，避免 prompt 过大
    const codePreview = file.content.slice(0, 1500);
    const prefill =
      `运行 \`${file.name}\` 失败（退出码 ${exitCode}）。\n\n` +
      `**输入 (stdin)**:\n\`\`\`\n${stdin || '(空)'}\n\`\`\`\n\n` +
      `**错误输出**:\n\`\`\`\n${errorLines || '(无 stderr)'}\n\`\`\`\n\n` +
      `**代码** (${file.language}):\n\`\`\`${file.language}\n${codePreview}${file.content.length > 1500 ? '\n// ... [中段省略]' : ''}\n\`\`\`\n\n` +
      `请帮我分析这个错误的原因，给出最小的修改建议。`;
    setAskPrefill(prefill);
    setFeedbackTab('ask');
    toast.info('已把错误信息发给 AI', { description: '右栏「问 AI」会自动展开输入框' });
  };

  const onClear = () => {
    setOutput([]);
    setDuration(null);
    setExitCode(null);
  };

  const supported = file ? isRuntimeSupported(file.language) : false;

  if (!open) {
    // 折叠状态：底部窄条
    return (
      <button
        onClick={() => setOpen(true)}
        className="h-7 border-t border-line bg-bg-elev hover:bg-bg-elev2 flex items-center gap-2 px-4 text-xs text-ink-dim w-full"
        title="展开终端"
      >
        <TerminalIcon size={12} />
        <span>终端</span>
        <ChevronUp size={12} className="ml-auto" />
      </button>
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

        {/* 失败时显示「让 AI 看」按钮：把 stderr + 代码 prefill 到问 AI */}
        {exitCode !== null && exitCode !== 0 && !running && (
          <button
            onClick={onAskAI}
            className="ml-2 px-2 py-0.5 text-[11px] rounded border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20 hover:border-accent/60 transition flex items-center gap-1 font-semibold"
            title="把错误输出 + 代码 + stdin 发给 AI 分析"
          >
            <Sparkles size={11} />
            让 AI 看看错误
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {!running ? (
            <button
              data-runtime-pane-run
              onClick={onRun}
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
