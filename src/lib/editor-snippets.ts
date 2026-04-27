/**
 * Monaco editor snippet 注册：算法竞赛/学生入门常用片段。
 * Tab 触发：输入 prefix 后按 Tab 或 Enter 选中即可展开。
 *
 * 每个 snippet 体内 ${1:placeholder} 是 Tab 跳转点。
 *
 * 只注册一次（用 module-level flag 防重）。
 */
import type { Monaco } from '@monaco-editor/react';

let registered = false;

export function registerSnippets(monaco: Monaco) {
  if (registered) return;
  registered = true;

  // ─── C++ ──────────────────────────────────────────
  const cpp = [
    {
      label: 'bits',
      kind: monaco.languages.CompletionItemKind.Snippet,
      detail: '万能头 + namespace',
      insertText: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n  ios::sync_with_stdio(false);\n  cin.tie(nullptr);\n\n  $0\n\n  return 0;\n}',
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'tt',
      detail: '多组测试用例',
      insertText: 'int t; cin >> t;\nwhile (t--) {\n  $0\n}',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'fori',
      detail: 'for(i=0;i<n;i++)',
      insertText: 'for (int i = 0; i < ${1:n}; i++) {\n  $0\n}',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'forj',
      detail: 'for(j=0;j<m;j++)',
      insertText: 'for (int j = 0; j < ${1:m}; j++) {\n  $0\n}',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'forr',
      detail: 'for(i=n-1;i>=0;i--)',
      insertText: 'for (int i = ${1:n} - 1; i >= 0; i--) {\n  $0\n}',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'fora',
      detail: 'for (auto& x : a)',
      insertText: 'for (auto& ${1:x} : ${2:a}) {\n  $0\n}',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'cf',
      detail: 'cin >> x',
      insertText: 'cin >> $0;',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'cot',
      detail: 'cout << x << "\\n"',
      insertText: 'cout << $0 << "\\n";',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'vec',
      detail: 'vector<int> a(n)',
      insertText: 'vector<${1:int}> ${2:a}(${3:n});',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'vec2',
      detail: 'vector<vector<int>> a(n, vector<int>(m))',
      insertText: 'vector<vector<${1:int}>> ${2:a}(${3:n}, vector<${1:int}>(${4:m}));',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'rda',
      detail: 'read array',
      insertText: 'for (int i = 0; i < ${1:n}; i++) cin >> ${2:a}[i];',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'wra',
      detail: 'write array',
      insertText: 'for (int i = 0; i < ${1:n}; i++) cout << ${2:a}[i] << " \\n"[i == ${1:n} - 1];',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'srt',
      detail: 'sort(a.begin(), a.end())',
      insertText: 'sort(${1:a}.begin(), ${1:a}.end());',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'mset',
      detail: 'memset(a, 0, sizeof a)',
      insertText: 'memset(${1:a}, ${2:0}, sizeof ${1:a});',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'dbg',
      detail: 'cerr << "x = " << x << endl',
      insertText: 'cerr << "${1:x} = " << ${1:x} << endl;',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'lambda',
      detail: 'auto f = [&](int x) -> int { ... }',
      insertText: 'auto ${1:f} = [&](${2:int x}) -> ${3:int} {\n  $0\n};',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
  ];

  for (const lang of ['cpp', 'c'] as const) {
    monaco.languages.registerCompletionItemProvider(lang, {
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        return {
          suggestions: cpp.map((s) => ({ ...s, range })),
        };
      },
    });
  }

  // ─── Python ──────────────────────────────────────────
  const py = [
    {
      label: 'main',
      detail: 'if __name__ == "__main__":',
      insertText: 'if __name__ == "__main__":\n    ${1:main}()',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'inp',
      detail: 'input()',
      insertText: '${1:n} = int(input())',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'inps',
      detail: 'input().split() to ints',
      insertText: '${1:a} = list(map(int, input().split()))',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'fori',
      detail: 'for i in range(n)',
      insertText: 'for ${1:i} in range(${2:n}):\n    $0',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'fora',
      detail: 'for x in a',
      insertText: 'for ${1:x} in ${2:a}:\n    $0',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'def',
      detail: 'def f(...):',
      insertText: 'def ${1:f}(${2:args}):\n    $0',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'pr',
      detail: 'print(...)',
      insertText: 'print($0)',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'enum',
      detail: 'for i, x in enumerate(a)',
      insertText: 'for ${1:i}, ${2:x} in enumerate(${3:a}):\n    $0',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'cls',
      detail: 'class Foo:',
      insertText: 'class ${1:Foo}:\n    def __init__(self${2:, args}):\n        $0',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
  ];

  monaco.languages.registerCompletionItemProvider('python', {
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      return {
        suggestions: py.map((s) => ({ ...s, range })),
      };
    },
  });
}
