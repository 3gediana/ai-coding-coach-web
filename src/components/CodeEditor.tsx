import Editor, { OnMount, type Monaco } from '@monaco-editor/react';
import { useEffect, useRef } from 'react';
import { useStore } from '../lib/store';
import type { CodeIssue } from '../core/types';
import { motion } from 'framer-motion';
import { FileCode } from 'lucide-react';

export function CodeEditor() {
  const language = useStore((s) => s.language);
  const codeByProblem = useStore((s) => s.codeByProblem);
  const activeProblemId = useStore((s) => s.activeProblemId);
  const setCode = useStore((s) => s.setCode);
  const analysisByProblem = useStore((s) => s.analysisByProblem);

  const key = activeProblemId ?? '__draft__';
  const code = codeByProblem[key] ?? '';
  const result = analysisByProblem[key];

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  // 当前活跃的 issues（按行去重；用户改了某行就从这里删）
  const activeIssuesRef = useRef<CodeIssue[]>([]);

  const renderDecorations = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const issues = activeIssuesRef.current;
    if (issues.length === 0) {
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
      return;
    }
    const decorations = issues.map((iss) => ({
      range: new monaco.Range(iss.line, 1, iss.line, 1),
      options: {
        isWholeLine: true,
        className: `aicc-line-${iss.severity}`,
        glyphMarginClassName: `aicc-glyph-${iss.severity}`,
        glyphMarginHoverMessage: {
          value: `**[${iss.severity.toUpperCase()}/${iss.category}]** ${iss.message}\n\n${iss.suggestion ?? ''}`,
        },
        after: {
          content: `   ${severityIcon(iss.severity)} ${iss.message.slice(0, 60)}${iss.message.length > 60 ? '…' : ''}`,
          inlineClassName: `aicc-after-${iss.severity}`,
          margin: '4em',
        },
        hoverMessage: {
          value: `**${iss.message}**\n\n${iss.suggestion ?? ''}`,
        },
      },
    }));
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations);
  };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    monaco.editor.defineTheme('aicc-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5f6884', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7c83ff' },
        { token: 'string', foreground: '34d399' },
        { token: 'number', foreground: '22d3ee' },
      ],
      colors: {
        'editor.background': '#0c0e18',
        'editor.lineHighlightBackground': '#11131e',
        'editorLineNumber.foreground': '#3a4154',
        'editorLineNumber.activeForeground': '#9aa3b8',
        'editorCursor.foreground': '#7c83ff',
        'editor.selectionBackground': '#7c83ff44',
        'editorIndentGuide.background1': '#1a1f30',
        'editorWidget.background': '#161a28',
        'editorWidget.border': '#262b3d',
        'editorSuggestWidget.background': '#161a28',
        'editorSuggestWidget.border': '#262b3d',
      },
    });
    monaco.editor.setTheme('aicc-dark');

    // 用户改某行 -> 移除该行 issue + 行偏移时清掉变更点之后
    editor.onDidChangeModelContent((e: any) => {
      const issues = activeIssuesRef.current;
      if (issues.length === 0) return;
      const dirty = new Set<number>();
      let conservativeFrom = Number.POSITIVE_INFINITY;
      for (const ch of e.changes) {
        const start = ch.range.startLineNumber;
        const end = ch.range.endLineNumber;
        for (let l = start; l <= end; l++) dirty.add(l);
        const inserted = (ch.text.match(/\n/g) ?? []).length;
        const deleted = end - start;
        if (inserted !== deleted) {
          conservativeFrom = Math.min(conservativeFrom, start);
        }
      }
      const remaining = issues.filter(
        (i) => !dirty.has(i.line) && i.line <= conservativeFrom,
      );
      if (remaining.length !== issues.length) {
        activeIssuesRef.current = remaining;
        renderDecorations();
      }
    });
  };

  // 收到新结果 -> 重置 active issues + 渲染
  useEffect(() => {
    if (!result) {
      activeIssuesRef.current = [];
    } else {
      activeIssuesRef.current = result.issues.slice();
    }
    renderDecorations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // 切语言 / 切题：清掉旧 decoration（避免行号错位残留）
  useEffect(() => {
    activeIssuesRef.current = result ? result.issues.slice() : [];
    renderDecorations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProblemId, language]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="h-9 px-4 border-b border-line bg-bg-elev/30 flex items-center gap-2 text-xs text-ink-dim">
        <FileCode size={14} />
        <span>{activeProblemId ? '激活题目代码区' : '草稿区（未激活题目）'}</span>
        <span className="text-ink-mute mx-1">·</span>
        <span className="font-mono">{language}</span>
        {result && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="ml-auto flex items-center gap-3 text-[11px]"
          >
            <span className="text-ink-mute">已分析 ·</span>
            {result.issues.length === 0 ? (
              <span className="chip-ok">无问题</span>
            ) : (
              <>
                <Counter
                  count={result.issues.filter((i) => i.severity === 'error').length}
                  label="错误"
                  cls="chip-bad"
                />
                <Counter
                  count={result.issues.filter((i) => i.severity === 'warning').length}
                  label="警告"
                  cls="chip-warn"
                />
                <Counter
                  count={result.issues.filter((i) => i.severity === 'info' || i.severity === 'hint').length}
                  label="提示"
                  cls="chip-accent"
                />
              </>
            )}
          </motion.div>
        )}
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          theme="aicc-dark"
          language={language === 'cpp' ? 'cpp' : language === 'c' ? 'c' : 'python'}
          value={code}
          onChange={(v) => setCode(v ?? '')}
          onMount={onMount}
          options={{
            fontFamily: 'JetBrains Mono, Menlo, monospace',
            fontSize: 14,
            fontLigatures: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderLineHighlight: 'all',
            smoothScrolling: true,
            cursorSmoothCaretAnimation: 'on',
            cursorBlinking: 'smooth',
            padding: { top: 16, bottom: 16 },
            glyphMargin: true,
            tabSize: language === 'python' ? 4 : 2,
            wordWrap: 'on',
            renderWhitespace: 'selection',
            stickyScroll: { enabled: false },
          }}
        />
      </div>
      <style>{`
        .aicc-line-error { background: rgba(248,113,113,0.06); }
        .aicc-line-warning { background: rgba(251,191,36,0.05); }
        .aicc-line-info { background: rgba(34,211,238,0.04); }
        .aicc-after-error { color: #f87171 !important; opacity: 0.85; font-style: italic; }
        .aicc-after-warning { color: #fbbf24 !important; opacity: 0.85; font-style: italic; }
        .aicc-after-info { color: #22d3ee !important; opacity: 0.8; font-style: italic; }
        .aicc-after-hint { color: #9aa3b8 !important; opacity: 0.7; font-style: italic; }
        .aicc-glyph-error { background: #f87171; width: 3px !important; margin-left: 3px; border-radius: 2px; }
        .aicc-glyph-warning { background: #fbbf24; width: 3px !important; margin-left: 3px; border-radius: 2px; }
        .aicc-glyph-info { background: #22d3ee; width: 3px !important; margin-left: 3px; border-radius: 2px; }
        .aicc-glyph-hint { background: #9aa3b8; width: 3px !important; margin-left: 3px; border-radius: 2px; }
      `}</style>
    </div>
  );
}

function Counter({ count, label, cls }: { count: number; label: string; cls: string }) {
  if (count === 0) return null;
  return (
    <span className={cls}>
      {count} {label}
    </span>
  );
}

function severityIcon(s: string) {
  return s === 'error' ? '✗' : s === 'warning' ? '⚠' : s === 'info' ? '◇' : '·';
}
