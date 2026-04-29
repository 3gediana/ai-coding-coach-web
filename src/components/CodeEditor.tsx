import Editor, { OnMount, type Monaco } from '@monaco-editor/react';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import type { CodeIssue, FileLang } from '../core/types';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, Code2, MessageCircleQuestion, BookOpen, Bug } from 'lucide-react';
import { cn } from '../lib/cn';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { registerSnippets } from '../lib/editor-snippets';

/** 根据 <html data-theme> 当前值，把对应的 monaco 主题应用上 */
function applyMonacoTheme(monaco: Monaco) {
  const t = document.documentElement.getAttribute('data-theme') || 'parchment';
  const map: Record<string, string> = {
    parchment: 'aicc-parchment',
    'vscode-dark': 'aicc-dark',
    'aicc-classic': 'aicc-classic',
  };
  monaco.editor.setTheme(map[t] ?? 'aicc-parchment');
}

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

  // 框选「问 AI」浮按钮：选区非空且 ≥ 2 字符时浮起
  const [askBtn, setAskBtn] = useState<{ x: number; y: number; text: string } | null>(null);
  // 容器 ref：浮按钮的绝对定位用容器坐标系
  const containerRef = useRef<HTMLDivElement>(null);

  // Monaco refs
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationIdsRef = useRef<string[]>([]);
  const contentWidgetsRef = useRef<any[]>([]);
  const activeIssuesRef = useRef<CodeIssue[]>([]);

  const renderDecorations = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;
    const issues = activeIssuesRef.current;

    // 先清旧 widget
    for (const w of contentWidgetsRef.current) {
      try { editor.removeContentWidget(w); } catch {}
    }
    contentWidgetsRef.current = [];

    if (issues.length === 0) {
      decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, []);
      return;
    }

    // ① 整行 tint + glyph margin 图标（用 deltaDecorations）
    const decorations = issues.map((iss) => {
      const fullHover = {
        value: `**[${iss.severity.toUpperCase()}/${iss.category}]** ${iss.message}\n\n${iss.suggestion ?? ''}`,
      };
      return {
        range: new monaco.Range(iss.line, 1, iss.line, 1),
        options: {
          isWholeLine: true,
          className: `aicc-line-${iss.severity}`,
          glyphMarginClassName: `aicc-glyph-${iss.severity}`,
          glyphMarginHoverMessage: fullHover,
          hoverMessage: fullHover,
        },
      };
    });
    decorationIdsRef.current = editor.deltaDecorations(decorationIdsRef.current, decorations);

    // ② 行末追加批注文字（用 ContentWidget，比 after.content 兼容性更好）
    const model = editor.getModel();
    if (!model) return;
    issues.forEach((iss, idx) => {
      const lineMaxCol = model.getLineMaxColumn(iss.line);
      // 中文宽度 ≈ 2 倍英文，截到 32 个字符避免溢出与下一行重叠
      const shortMsg =
        iss.message.slice(0, 32) + (iss.message.length > 32 ? '…' : '');
      const node = document.createElement('span');
      node.className = `aicc-after-${iss.severity}`;
      node.textContent = `  // ${severityIcon(iss.severity)} ${shortMsg}`;
      // 完整内容：hover 时浏览器原生 tooltip 显示
      node.title =
        iss.message +
        (iss.suggestion ? '\n\n💡 建议：' + iss.suggestion : '') +
        '\n\n（点击查看完整 + 跳到详细面板）';
      // 点击批注 → 切到「分析」tab + 滚动到对应 issue
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        useStore.getState().setFeedbackTab('analyze');
      });
      const widget = {
        getId: () => `aicc-annot-${idx}-${iss.line}`,
        getDomNode: () => node,
        getPosition: () => ({
          position: { lineNumber: iss.line, column: lineMaxCol },
          preference: [
            monaco.editor.ContentWidgetPositionPreference.EXACT,
          ],
        }),
      };
      editor.addContentWidget(widget);
      contentWidgetsRef.current.push(widget);
    });
  };

  const onMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    // Parchment 米黄主题（默认）
    monaco.editor.defineTheme('aicc-parchment', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6e6041', fontStyle: 'italic' },
        { token: 'keyword', foreground: '8b6914', fontStyle: 'bold' },
        { token: 'string', foreground: '556b2f' },
        { token: 'number', foreground: '4682b4' },
        { token: 'type', foreground: '9a341c' },
      ],
      colors: {
        'editor.background': '#faf4e2',
        'editor.lineHighlightBackground': '#f3eacc',
        'editorLineNumber.foreground': '#b8a575',
        'editorLineNumber.activeForeground': '#6e6041',
        'editorCursor.foreground': '#8b6914',
        'editor.selectionBackground': '#8b691433',
        'editorIndentGuide.background1': '#eadebb',
        'editorWidget.background': '#fef9e8',
        'editorWidget.border': '#d4c499',
        'editorSuggestWidget.background': '#fef9e8',
        'editorSuggestWidget.border': '#d4c499',
      },
    });
    // VS Code Dark
    monaco.editor.defineTheme('aicc-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
        { token: 'keyword', foreground: '569cd6' },
        { token: 'string', foreground: 'ce9178' },
        { token: 'number', foreground: 'b5cea8' },
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.lineHighlightBackground': '#252526',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#cccccc',
        'editorCursor.foreground': '#aeafad',
        'editorIndentGuide.background1': '#404040',
        'editorWidget.background': '#252526',
        'editorWidget.border': '#3c3c3c',
        'editorSuggestWidget.background': '#252526',
        'editorSuggestWidget.border': '#3c3c3c',
      },
    });
    // 经典紫
    monaco.editor.defineTheme('aicc-classic', {
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
    applyMonacoTheme(monaco);

    // 监听 data-theme 变化（用户切换主题时同步切 Monaco）
    const obs = new MutationObserver(() => applyMonacoTheme(monaco));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // 编辑器 unmount 时清理（onMount 没 cleanup，但 effect 不在这里跑）
    (editor as any)._aiccObserver?.disconnect();
    (editor as any)._aiccObserver = obs;

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

    // 框选「问 AI」：选区非空 → 浮按钮
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      if (!sel || sel.isEmpty()) {
        setAskBtn(null);
        return;
      }
      const model = editor.getModel();
      if (!model) return;
      const text = model.getValueInRange(sel);
      // 太短 / markdown / plaintext 不触发
      if (text.trim().length < 2) {
        setAskBtn(null);
        return;
      }
      const f = useStore.getState().filesByScope[
        useStore.getState().activeProblemId ?? '__draft__'
      ]?.find((x) => x.id === useStore.getState().activeFileIdByScope[
        useStore.getState().activeProblemId ?? '__draft__'
      ]);
      if (f && (f.language === 'markdown' || f.language === 'plaintext')) {
        setAskBtn(null);
        return;
      }
      // 计算选区起点的视口坐标 → 转换到 container 坐标系
      // 按钮浮在选区右上角（往上移 28px 避开光标）
      const startLn = Math.min(sel.startLineNumber, sel.endLineNumber);
      const startCol = sel.startLineNumber < sel.endLineNumber
        ? sel.startColumn
        : Math.min(sel.startColumn, sel.endColumn);
      const pos = editor.getScrolledVisiblePosition({
        lineNumber: startLn,
        column: startCol,
      });
      const editorDom = editor.getDomNode();
      const container = containerRef.current;
      if (!pos || !editorDom || !container) return;
      const editorRect = editorDom.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      // 容器坐标 = 视口坐标 - 容器视口左上
      const x = editorRect.left - containerRect.left + pos.left + 8;
      const y = editorRect.top - containerRect.top + pos.top - 30;
      setAskBtn({ x, y, text });
    });

    // 编辑器失焦也保留按钮（让用户能点）
    // 但选区清空（点别处）会通过上面的 onDidChangeCursorSelection 自动隐藏
  };

  /**
   * 框选浮按钮三种动作：
   * - ask: 把代码 prefill 到输入框，让用户继续打具体问题
   * - explain: 直接发预设"解释这段代码"问题，不需打字
   * - bug:    直接发预设"找 bug"问题，不需打字
   */
  const handleAction = (action: 'ask' | 'explain' | 'bug') => {
    if (!askBtn) return;
    const lang = file?.language ?? '';
    const codeBlock = `\`\`\`${lang}\n${askBtn.text}\n\`\`\``;
    const st = useStore.getState();

    if (action === 'ask') {
      // prefill 到输入框，光标停在末尾，用户接着打具体问题
      st.setAskPrefill(`关于这段代码：\n${codeBlock}\n\n`);
    } else {
      // 直接发预设问题，不打字
      const presets: Record<'explain' | 'bug', string> = {
        explain: `请简要解释下面这段代码在做什么 / 思路是什么：\n${codeBlock}`,
        bug: `下面这段代码可能有什么 bug 或潜在问题？请指出最可能的 1-2 处：\n${codeBlock}`,
      };
      st.askQuestion(presets[action]);
    }
    st.setFeedbackTab('ask');
    setAskBtn(null);
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
        <div className="flex-1 flex items-center justify-center text-ink-mute text-sm">
          没有文件，点左侧 + 新建
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
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

      <div ref={containerRef} className="flex-1 min-h-0 flex relative">
        {/* 框选浮按钮组：问 AI / 解释 / 找 bug */}
        <AnimatePresence>
          {askBtn && (
            <motion.div
              initial={{ opacity: 0, y: 4, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.92 }}
              transition={{ duration: 0.12 }}
              onMouseDown={(e) => e.preventDefault()} // 防止 monaco 失焦清选区
              className="absolute z-30 flex items-stretch text-[11px] font-medium rounded-md shadow-lg overflow-hidden border border-line bg-bg-elev"
              style={{ left: askBtn.x, top: Math.max(askBtn.y, 0) }}
            >
              <button
                onClick={() => handleAction('ask')}
                className="flex items-center gap-1 px-2 py-1 bg-accent text-bg hover:brightness-110 transition cursor-pointer"
                title="把这段代码塞到输入框，自己写具体问题"
              >
                <MessageCircleQuestion size={11} />
                问 AI
              </button>
              <button
                onClick={() => handleAction('explain')}
                className="flex items-center gap-1 px-2 py-1 text-ink hover:bg-cyan/15 hover:text-cyan transition cursor-pointer border-l border-line"
                title="解释这段代码做什么"
              >
                <BookOpen size={11} />
                解释
              </button>
              <button
                onClick={() => handleAction('bug')}
                className="flex items-center gap-1 px-2 py-1 text-ink hover:bg-bad/15 hover:text-bad transition cursor-pointer border-l border-line"
                title="找出可能的 bug / 潜在问题"
              >
                <Bug size={11} />
                找 bug
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {!showPreview && (
          <div className={cn('flex-1 min-w-0', isMd && mdPreview && 'border-r border-line')}>
            <Editor
              height="100%"
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
