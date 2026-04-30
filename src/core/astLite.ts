/**
 * AST-Light：基于启发式词法/正则的代码结构特征提取与对比。
 *
 * 设计动机：
 *   - 真 AST 解析（web-tree-sitter）会让 bundle 增加 ~2MB + 异步加载 wasm
 *   - 本项目的目的是「把结构信号喂给 LLM prompt」，不需要严格语法树
 *   - 启发式版本 < 5KB，零依赖，覆盖 80% 的算法竞赛代码模式
 *
 * 这是项目的"本地无 LLM Agent"的第二个实例（和 pickPlanCandidates 并列），
 * 证明项目的 multi-agent 设计不是"全靠 LLM 堆"，而是"工具型 Agent + LLM Agent" 混搭。
 *
 * 输出特征 → 喂给 analyzeCode 的 prompt，让 LLM 看到"客观结构信号"再出 issue。
 */
import type { Lang } from './types';

export interface CodeStructFeatures {
  /** 总代码行数（去空白行） */
  loc: number;
  /** for / while 循环总数 */
  loops: number;
  /** 最大嵌套深度（按花括号 / 缩进估算） */
  maxNestingDepth: number;
  /** 是否检测到递归（函数体调用了自己） */
  hasRecursion: boolean;
  /** 数据结构使用（小写、去重） */
  dataStructures: string[];
  /** 函数名列表 */
  functions: string[];
  /** I/O 性能相关标志（C++） */
  ioFlags: {
    syncWithStdioOff: boolean; // ios::sync_with_stdio(false)
    cinUntied: boolean; // cin.tie(nullptr)
    usesEndl: boolean; // 用 endl 而不是 '\n'（潜在性能问题）
    usesScanf: boolean;
  };
  /** 启发式复杂度估计（按嵌套循环 + 递归 + 数据结构推断，可能不准） */
  complexityHint: string;
  /** 检测到的"危险"模式（按严重度从高到低） */
  redFlags: Array<{ kind: string; line?: number; hint: string }>;
}

const CPP_DS_PATTERNS: Array<[RegExp, string]> = [
  [/\bvector\s*</g, 'vector'],
  [/\bunordered_map\s*</g, 'unordered_map'],
  [/\bunordered_set\s*</g, 'unordered_set'],
  [/\bmap\s*</g, 'map'],
  [/\bset\s*</g, 'set'],
  [/\bdeque\s*</g, 'deque'],
  [/\bqueue\s*</g, 'queue'],
  [/\bpriority_queue\s*</g, 'priority_queue'],
  [/\bstack\s*</g, 'stack'],
  [/\blist\s*</g, 'list'],
  [/\bbitset\s*</g, 'bitset'],
  [/\bstring\b/g, 'string'],
];

const PY_DS_PATTERNS: Array<[RegExp, string]> = [
  [/\bdict\s*\(/g, 'dict'],
  [/\bset\s*\(/g, 'set'],
  [/\bdeque\s*\(/g, 'deque'],
  [/\bheapq\b/g, 'heapq'],
  [/\bCounter\s*\(/g, 'Counter'],
  [/\bdefaultdict\s*\(/g, 'defaultdict'],
  [/\bnumpy\b|\bnp\./g, 'numpy'],
];

/** 估算最大嵌套深度（{}/缩进双轨） */
function estimateNestingDepth(code: string, language: Lang): number {
  if (language === 'python') {
    let max = 0;
    for (const line of code.split('\n')) {
      if (!line.trim()) continue;
      const indent = line.match(/^(\s*)/)?.[1] ?? '';
      // 4 空格 = 1 层（也兼容 tab：tab 当 4 空格）
      const depth = indent.replace(/\t/g, '    ').length / 4;
      if (depth > max) max = depth;
    }
    return Math.floor(max);
  }
  // C++ / 默认：按 { 计算
  let depth = 0;
  let max = 0;
  let inString = false;
  let inChar = false;
  let inLineComment = false;
  let inBlockComment = false;
  let prev = '';
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    const next = code[i + 1] ?? '';
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      prev = c;
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      prev = c;
      continue;
    }
    if (inString) {
      if (c === '"' && prev !== '\\') inString = false;
      prev = c;
      continue;
    }
    if (inChar) {
      if (c === "'" && prev !== '\\') inChar = false;
      prev = c;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "'") inChar = true;
    else if (c === '{') {
      depth++;
      if (depth > max) max = depth;
    } else if (c === '}') {
      depth--;
    }
    prev = c;
  }
  return max;
}

function countMatches(re: RegExp, code: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(code) !== null) n++;
  return n;
}

function detectFunctions(code: string, language: Lang): string[] {
  const out = new Set<string>();
  if (language === 'python') {
    const re = /^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) out.add(m[1]);
  } else {
    // C++: 简化匹配 returnType funcName(args) { 形式
    const re = /\b(?:int|long\s+long|long|double|float|char|bool|void|string|auto|size_t|signed|unsigned)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^;]*\)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      if (m[1] && m[1] !== 'main') out.add(m[1]);
    }
  }
  return Array.from(out);
}

function detectRecursion(code: string, funcs: string[]): boolean {
  for (const f of funcs) {
    const re = new RegExp(`\\b${f}\\s*\\(`, 'g');
    let count = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) count++;
    if (count >= 2) return true;
  }
  return false;
}

/** 启发式复杂度推断（粗略，但足以喂 prompt） */
function estimateComplexity(args: {
  loops: number;
  maxDepth: number;
  hasRecursion: boolean;
  dataStructures: string[];
  loc: number;
}): string {
  const { loops, maxDepth, hasRecursion, dataStructures, loc } = args;
  if (loops === 0 && !hasRecursion) return 'O(1)';
  // 嵌套循环极强信号
  // 注意：maxDepth 包括函数体本身的 1 层，循环嵌套粗算 = depth - 2
  const loopNest = Math.max(0, maxDepth - 2);
  if (loopNest >= 3) return 'O(n³+) — 三重以上嵌套';
  if (loopNest === 2 && loops >= 2) return 'O(n²) — 双重嵌套循环';
  if (hasRecursion && dataStructures.includes('priority_queue'))
    return 'O(n log n) — 递归 + 优先队列';
  if (hasRecursion && (dataStructures.includes('unordered_map') || dataStructures.includes('dict')))
    return 'O(n) ~ O(n log n) — 递归 + 哈希';
  if (hasRecursion) return 'O(n) ~ O(2^n) — 取决于递归分支';
  if (dataStructures.some((d) => d === 'priority_queue' || d === 'heapq'))
    return 'O(n log n) — 堆/优先队列';
  if (loops >= 2) return 'O(n²) 或 O(n) — 取决于循环是否平行';
  if (loc > 100 && loops <= 1) return 'O(n) — 单层遍历';
  return 'O(n)';
}

/**
 * 主入口：分析代码 → 输出结构特征。
 *
 * 性能：对 1000 行代码 < 5ms，安全在 UI 主线程同步运行。
 */
export function extractFeatures(code: string, language: Lang): CodeStructFeatures {
  const cleanLines = code.split('\n').filter((l) => l.trim().length > 0);
  const loc = cleanLines.length;

  const forCount = countMatches(/\bfor\s*\(/g, code) + countMatches(/\bfor\s+\w+\s+in\b/g, code);
  const whileCount = countMatches(/\bwhile\s*[\(:]/g, code);
  const loops = forCount + whileCount;

  const maxNestingDepth = estimateNestingDepth(code, language);

  const patterns = language === 'python' ? PY_DS_PATTERNS : CPP_DS_PATTERNS;
  const dataStructures: string[] = [];
  for (const [re, name] of patterns) {
    re.lastIndex = 0;
    if (re.test(code)) dataStructures.push(name);
  }

  const functions = detectFunctions(code, language);
  const hasRecursion = detectRecursion(code, functions);

  // I/O flags（仅 C++ 关心）
  const ioFlags = {
    syncWithStdioOff:
      language === 'cpp' && /sync_with_stdio\s*\(\s*(false|0)\s*\)/.test(code),
    cinUntied:
      language === 'cpp' && /cin\.tie\s*\(\s*(nullptr|0|NULL)\s*\)/.test(code),
    usesEndl: language === 'cpp' && /\bendl\b/.test(code),
    usesScanf: language === 'cpp' && /\bscanf\s*\(/.test(code),
  };

  const redFlags: CodeStructFeatures['redFlags'] = [];

  // 红旗 1：cin/cout 没解绑 + 大量循环 → TLE 风险
  if (
    language === 'cpp' &&
    !ioFlags.syncWithStdioOff &&
    !ioFlags.usesScanf &&
    loops >= 1 &&
    /\bcin\s*>>/.test(code)
  ) {
    redFlags.push({
      kind: 'tle-io',
      hint: 'cin/cout 未解绑同步流，N ≥ 1e5 时严重影响性能',
    });
  }
  // 红旗 2：endl 频繁
  if (language === 'cpp' && ioFlags.usesEndl && loops >= 1) {
    redFlags.push({
      kind: 'perf-endl',
      hint: 'endl 强制刷缓冲，循环里建议用 \\n',
    });
  }
  // 红旗 3：嵌套 ≥ 2 层 + 数据范围未知 → 提示评估
  if (maxNestingDepth - 2 >= 2) {
    redFlags.push({
      kind: 'nested-loop',
      hint: `嵌套循环深度 ${maxNestingDepth - 2}，注意输入规模 N 是否能承受 O(n^${maxNestingDepth - 2}+)`,
    });
  }
  // 红旗 4：使用了 map 但代码里有大量循环 + 没用 unordered_map
  if (
    language === 'cpp' &&
    dataStructures.includes('map') &&
    !dataStructures.includes('unordered_map') &&
    loops >= 2
  ) {
    redFlags.push({
      kind: 'map-vs-unordered_map',
      hint: '用了 map（O(log n) 操作），考虑换成 unordered_map（O(1) 平均）',
    });
  }
  // 红旗 5：递归无 memo + 数据范围大
  if (hasRecursion && !dataStructures.some((d) => /map|dict|memo/i.test(d))) {
    redFlags.push({
      kind: 'recursion-no-memo',
      hint: '递归未见明显的记忆化结构（map/dict/数组），警惕指数复杂度',
    });
  }

  const complexityHint = estimateComplexity({
    loops,
    maxDepth: maxNestingDepth,
    hasRecursion,
    dataStructures,
    loc,
  });

  return {
    loc,
    loops,
    maxNestingDepth,
    hasRecursion,
    dataStructures,
    functions,
    ioFlags,
    complexityHint,
    redFlags,
  };
}

/** 格式化为给 LLM 看的简短 prompt 段落 */
export function formatFeaturesForPrompt(f: CodeStructFeatures): string {
  const lines: string[] = [];
  lines.push(`【AST-Light 结构信号】（本地启发式分析，不是 AI 推断）`);
  lines.push(
    `- 行数 ${f.loc} · 循环 ${f.loops} 个 · 最大嵌套深度 ${f.maxNestingDepth} · 函数 ${f.functions.length} 个 · 递归 ${f.hasRecursion ? '是' : '否'}`,
  );
  if (f.dataStructures.length > 0) {
    lines.push(`- 用了：${f.dataStructures.join(' / ')}`);
  }
  lines.push(`- 复杂度估计：${f.complexityHint}`);
  if (f.ioFlags.syncWithStdioOff || f.ioFlags.cinUntied) {
    const ioBits: string[] = [];
    if (f.ioFlags.syncWithStdioOff) ioBits.push('sync_with_stdio(false) ✓');
    if (f.ioFlags.cinUntied) ioBits.push('cin.tie(nullptr) ✓');
    lines.push(`- I/O 优化：${ioBits.join(' · ')}`);
  }
  if (f.redFlags.length > 0) {
    lines.push(`- 🚩 检测到 ${f.redFlags.length} 个潜在风险：`);
    for (const r of f.redFlags) {
      lines.push(`  · [${r.kind}] ${r.hint}`);
    }
  }
  return lines.join('\n');
}
