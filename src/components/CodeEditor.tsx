import Editor, { OnMount, type Monaco } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import type { CodeIssue, FileLang } from '../core/types';
import { motion } from 'framer-motion';
import { Eye, Code2 } from 'lucide-react';
import { cn } from '../lib/cn';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TabBar } from './TabBar';
import { registerSnippets } from '../lib/editor-snippets';

const DRAFT_SCOPE = '__draft__';

export function CodeEditor() {
  const activeProblemId = useStore((s) => s.activeProblemId);
  const filesByScope = useStore((s) => s.filesByScope);
  const activeFileIdByScope = useStore((s) => s.activeFileIdByScope);
  const updateFileContent = useStore((s) => s.updateFileContent);
  const analysisByProblem = useStore((s) => s.analysisByProblem);

  const scope = activeProblemId ?? DRAFT_SCOPE;
  const files = filesByScope[scope] ?? [];
  const activeId = activeFileIdByScope[scope];
  const file = files.find((f) => f.id === activeId);

  const result = analysisByProblem[scope];

  // markdown 预览开关
  const [mdPreview, setMdPreview] = useState(false);
  const isMd = file?.language === 'markdown';
  const showPreview = isMd && mdPreview;

  // Monaco refs
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
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

    // 注册 cpp/c/python 常用 snippet（学生级最常用）
    registerSnippets(monaco);

    // 用户改某行 -> 移除该行 issue + 更新 lastEditAt
    editor.onDidChangeModelContent((e: any) => {
      // 标记编辑活动（卡住检测用）
      useStore.getState().markEdit();

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

    // 粘贴检测：≥ 30 行触发提示
    editor.onDidPaste((e: any) => {
      try {
        const range = e.range;
        const lineCount = range.endLineNumber - range.startLineNumber + 1;
        if (lineCount >= 30) {
          const model = editor.getModel();
          if (!model) return;
          const snippet = model.getValueInRange(range);
          // 只对代码文件（不是 markdown / plaintext）触发
          const st = useStore.getState();
          const scope = st.activeProblemId ?? '__draft__';
          const fileId = st.activeFileIdByScope[scope];
          const f = (st.filesByScope[scope] ?? []).find((x) => x.id === fileId);
          if (!f) return;
          if (f.language === 'markdown' || f.language === 'plaintext') return;
          st.setPasteSuggestion({ snippet, lineCount });
        }
      } catch {
        /* ignore */
      }
    });
  };

  // 切文件 / 切题 → 重置 issues + decoration（避免行号错位）
  useEffect(() => {
    if (file && (file.language === 'cpp' || file.language === 'c' || file.language === 'python') && result) {
      activeIssuesRef.current = result.issues.slice();
    } else {
      activeIssuesRef.current = [];
    }
    renderDecorations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, result]);

  if (!file) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <TabBar />
        <div className="flex-1 flex items-center justify-center text-ink-mute text-sm">
          没有文件，点上方 + 新建
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TabBar />
      {/* 状态栏 */}
      <div className="h-7 px-3 border-b border-line/60 bg-bg-elev/30 flex items-center gap-2 text-[11px] text-ink-mute shrink-0">
        <span className="font-mono text-ink-dim">{file.name}</span>
        <span>·</span>
        <span className="font-mono">{file.language}</span>
        {isMd && (
          <button
            onClick={() => setMdPreview((v) => !v)}
            className={cn(
              'ml-2 px-2 py-0.5 rounded text-[10px] flex items-center gap-1 transition',
              mdPreview
                ? 'bg-warn/15 text-warn border border-warn/40'
                : 'bg-bg-elev2 text-ink-dim hover:text-ink border border-line',
            )}
          >
            {mdPreview ? <Eye size={10} /> : <Code2 size={10} />}
            {mdPreview ? '预览中' : '预览'}
          </button>
        )}
        {result && file.language !== 'markdown' && file.language !== 'plaintext' && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="ml-auto flex items-center gap-2"
          >
            <span>已分析 ·</span>
            {result.issues.length === 0 ? (
              <span className="chip-ok text-[9px] px-1 py-0">无问题</span>
            ) : (
              <>
                <Counter
                  count={result.issues.filter((i) => i.severity === 'error').length}
                  label="错误"
                  cls="chip-bad text-[9px] px-1 py-0"
                />
                <Counter
                  count={result.issues.filter((i) => i.severity === 'warning').length}
                  label="警告"
                  cls="chip-warn text-[9px] px-1 py-0"
                />
                <Counter
                  count={result.issues.filter((i) => i.severity === 'info' || i.severity === 'hint').length}
                  label="提示"
                  cls="chip-accent text-[9px] px-1 py-0"
                />
              </>
            )}
          </motion.div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex">
        {!showPreview && (
          <div className={cn('flex-1 min-w-0', isMd && mdPreview && 'border-r border-line')}>
            <Editor
              height="100%"
              theme="aicc-dark"
              path={file.id}
              language={monacoLanguage(file.language)}
              value={file.content}
              onChange={(v) => updateFileContent(file.id, v ?? '')}
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
                glyphMargin: file.language !== 'markdown' && file.language !== 'plaintext',
                tabSize: file.language === 'python' ? 4 : 2,
                wordWrap: 'on',
                renderWhitespace: 'selection',
                stickyScroll: { enabled: false },
                // 补全 / Tab 触发
                quickSuggestions: { other: true, comments: false, strings: false },
                suggestOnTriggerCharacters: true,
                acceptSuggestionOnEnter: 'smart',
                tabCompletion: 'on',
                snippetSuggestions: 'inline',
                wordBasedSuggestions: 'currentDocument',
                suggest: {
                  snippetsPreventQuickSuggestions: false,
                  showWords: true,
                  showSnippets: true,
                  showKeywords: true,
                },
              }}
            />
          </div>
        )}
        {showPreview && (
          <div className="flex-1 min-w-0 overflow-y-auto px-6 py-5 md-body bg-bg/40">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{file.content}</ReactMarkdown>
          </div>
        )}
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

function monacoLanguage(lang: FileLang): string {
  if (lang === 'cpp') return 'cpp';
  if (lang === 'c') return 'c';
  if (lang === 'python') return 'python';
  if (lang === 'markdown') return 'markdown';
  return 'plaintext';
}
