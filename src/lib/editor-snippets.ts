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
    {
      label: 'pb',
      detail: 'push_back(x)',
      insertText: '${1:a}.push_back(${2:x});',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'all',
      detail: 'a.begin(), a.end()',
      insertText: '${1:a}.begin(), ${1:a}.end()',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'lb',
      detail: 'lower_bound',
      insertText: 'lower_bound(${1:a}.begin(), ${1:a}.end(), ${2:x})',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'ub',
      detail: 'upper_bound',
      insertText: 'upper_bound(${1:a}.begin(), ${1:a}.end(), ${2:x})',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'pq',
      detail: 'priority_queue<int>',
      insertText: 'priority_queue<${1:int}> ${2:pq};',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'ump',
      detail: 'unordered_map',
      insertText: 'unordered_map<${1:int}, ${2:int}> ${3:mp};',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'pii',
      detail: 'pair<int,int>',
      insertText: 'pair<int, int>',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'modpow',
      detail: 'fast power modulo',
      insertText: 'long long modpow(long long a, long long b, long long mod) {\n  long long res = 1;\n  while (b) {\n    if (b & 1) res = res * a % mod;\n    a = a * a % mod;\n    b >>= 1;\n  }\n  return res;\n}',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
  ];

  const cppSymbols = [
    ['sort', 'sort(a.begin(), a.end())', 'sort(${1:a}.begin(), ${1:a}.end());'],
    ['stable_sort', 'stable_sort(a.begin(), a.end())', 'stable_sort(${1:a}.begin(), ${1:a}.end());'],
    ['reverse', 'reverse(a.begin(), a.end())', 'reverse(${1:a}.begin(), ${1:a}.end());'],
    ['lower_bound', 'first >= x', 'lower_bound(${1:a}.begin(), ${1:a}.end(), ${2:x})'],
    ['upper_bound', 'first > x', 'upper_bound(${1:a}.begin(), ${1:a}.end(), ${2:x})'],
    ['binary_search', 'binary_search range', 'binary_search(${1:a}.begin(), ${1:a}.end(), ${2:x})'],
    ['max_element', 'max element iterator', 'max_element(${1:a}.begin(), ${1:a}.end())'],
    ['min_element', 'min element iterator', 'min_element(${1:a}.begin(), ${1:a}.end())'],
    ['accumulate', 'sum range', 'accumulate(${1:a}.begin(), ${1:a}.end(), ${2:0LL})'],
    ['gcd', 'std::gcd(a,b)', 'gcd(${1:a}, ${2:b})'],
    ['queue', 'queue<T>', 'queue<${1:int}> ${2:q};'],
    ['stack', 'stack<T>', 'stack<${1:int}> ${2:st};'],
    ['deque', 'deque<T>', 'deque<${1:int}> ${2:dq};'],
    ['set', 'set<T>', 'set<${1:int}> ${2:s};'],
    ['map', 'map<K,V>', 'map<${1:int}, ${2:int}> ${3:mp};'],
    ['unordered_set', 'unordered_set<T>', 'unordered_set<${1:int}> ${2:s};'],
    ['unordered_map', 'unordered_map<K,V>', 'unordered_map<${1:int}, ${2:int}> ${3:mp};'],
  ].map(([label, detail, insertText]) => ({
    label,
    detail,
    insertText,
    kind: monaco.languages.CompletionItemKind.Function,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  }));

  const cppMembers = [
    ['push_back', 'append element', 'push_back(${1:x})'],
    ['pop_back', 'remove last element', 'pop_back()'],
    ['size', 'container size', 'size()'],
    ['empty', 'is empty', 'empty()'],
    ['clear', 'clear container', 'clear()'],
    ['begin', 'begin iterator', 'begin()'],
    ['end', 'end iterator', 'end()'],
    ['front', 'first element', 'front()'],
    ['back', 'last element', 'back()'],
    ['resize', 'resize container', 'resize(${1:n})'],
    ['insert', 'insert value', 'insert(${1:x})'],
    ['erase', 'erase value/iterator', 'erase(${1:x})'],
    ['find', 'find value', 'find(${1:x})'],
    ['count', 'count key', 'count(${1:x})'],
    ['substr', 'substring', 'substr(${1:pos}, ${2:len})'],
  ].map(([label, detail, insertText]) => ({
    label,
    detail,
    insertText,
    kind: monaco.languages.CompletionItemKind.Method,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  }));

  for (const lang of ['cpp', 'c'] as const) {
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.', '>', ':'],
      provideCompletionItems: (model: any, position: any) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const linePrefix = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const memberMode = /(?:\.|->)\w*$/.test(linePrefix);
        return {
          suggestions: (memberMode ? cppMembers : [...cpp, ...cppSymbols]).map((s) => ({ ...s, range })),
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
    {
      label: 'readline',
      detail: 'sys.stdin.readline',
      insertText: 'import sys\ninput = sys.stdin.readline',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'counter',
      detail: 'collections.Counter',
      insertText: 'from collections import Counter\n${1:cnt} = Counter(${2:a})',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'deque',
      detail: 'collections.deque',
      insertText: 'from collections import deque\n${1:q} = deque()',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
    {
      label: 'heap',
      detail: 'heapq min heap',
      insertText: 'import heapq\n${1:h} = []\nheapq.heappush(${1:h}, ${2:x})',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    },
  ];

  const pyBuiltins = [
    ['range', 'range(n)', 'range(${1:n})'],
    ['len', 'len(x)', 'len(${1:x})'],
    ['enumerate', 'enumerate(a)', 'enumerate(${1:a})'],
    ['sorted', 'sorted(a)', 'sorted(${1:a})'],
    ['sum', 'sum(a)', 'sum(${1:a})'],
    ['min', 'min(a)', 'min(${1:a})'],
    ['max', 'max(a)', 'max(${1:a})'],
    ['map', 'map(func, iterable)', 'map(${1:int}, ${2:input().split()})'],
    ['zip', 'zip(a, b)', 'zip(${1:a}, ${2:b})'],
    ['list', 'list(...)', 'list(${1:iterable})'],
    ['dict', 'dict(...)', 'dict(${1:items})'],
    ['set', 'set(...)', 'set(${1:items})'],
    ['int', 'int(x)', 'int(${1:x})'],
    ['str', 'str(x)', 'str(${1:x})'],
  ].map(([label, detail, insertText]) => ({
    label,
    detail,
    insertText,
    kind: monaco.languages.CompletionItemKind.Function,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  }));

  const pyModuleMembers: Record<string, Array<[string, string, string]>> = {
    math: [
      ['sqrt', 'square root', 'sqrt(${1:x})'],
      ['ceil', 'ceil', 'ceil(${1:x})'],
      ['floor', 'floor', 'floor(${1:x})'],
      ['gcd', 'gcd(a,b)', 'gcd(${1:a}, ${2:b})'],
      ['sin', 'sin', 'sin(${1:x})'],
      ['cos', 'cos', 'cos(${1:x})'],
      ['factorial', 'factorial', 'factorial(${1:n})'],
    ],
    heapq: [
      ['heappush', 'push heap item', 'heappush(${1:h}, ${2:x})'],
      ['heappop', 'pop heap item', 'heappop(${1:h})'],
      ['heapify', 'heapify list', 'heapify(${1:h})'],
      ['nlargest', 'n largest', 'nlargest(${1:k}, ${2:a})'],
      ['nsmallest', 'n smallest', 'nsmallest(${1:k}, ${2:a})'],
    ],
    collections: [
      ['Counter', 'multiset counter', 'Counter(${1:a})'],
      ['defaultdict', 'defaultdict(list)', 'defaultdict(${1:list})'],
      ['deque', 'double-ended queue', 'deque(${1:})'],
    ],
    bisect: [
      ['bisect_left', 'lower_bound', 'bisect_left(${1:a}, ${2:x})'],
      ['bisect_right', 'upper_bound', 'bisect_right(${1:a}, ${2:x})'],
      ['insort', 'insert sorted', 'insort(${1:a}, ${2:x})'],
    ],
    itertools: [
      ['permutations', 'permutations', 'permutations(${1:a})'],
      ['combinations', 'combinations', 'combinations(${1:a}, ${2:r})'],
      ['product', 'cartesian product', 'product(${1:a}, ${2:b})'],
      ['accumulate', 'prefix accumulation', 'accumulate(${1:a})'],
    ],
    sys: [
      ['stdin', 'standard input', 'stdin'],
      ['setrecursionlimit', 'set recursion limit', 'setrecursionlimit(${1:10**7})'],
      ['exit', 'exit program', 'exit()'],
    ],
  };

  monaco.languages.registerCompletionItemProvider('python', {
    triggerCharacters: ['.'],
    provideCompletionItems: (model: any, position: any) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const linePrefix = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });
      const moduleMatch = linePrefix.match(/\b(math|heapq|collections|bisect|itertools|sys)\.\w*$/);
      if (moduleMatch) {
        return {
          suggestions: pyModuleMembers[moduleMatch[1]].map(([label, detail, insertText]) => ({
            label,
            detail,
            insertText,
            kind: monaco.languages.CompletionItemKind.Method,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      }
      return {
        suggestions: [...py, ...pyBuiltins].map((s) => ({ ...s, range })),
      };
    },
  });
}
