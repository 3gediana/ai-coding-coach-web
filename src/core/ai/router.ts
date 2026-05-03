/**
 * AI 模型路由：在 fastLane（本地，~30 tps，零成本）和 主 client（云端，高质量、烧 token）之间切换。
 *
 * 设计原则：
 * - **尽可能用 fastLane**（本地速度快、零成本，符合"实时批注"场景）
 * - 但简单题之外的场景（长代码、难题、复杂主题）用主云端模型
 * - 一次性高质量任务（题面解析、错题总结）始终走主
 *
 * 纯函数：路由决策不依赖任何全局状态，便于测试和复用。
 */
import type { Problem } from '../types';

/** 路由信号汇总 */
export interface RouteHints {
  /** 任务种类（决定基础策略） */
  taskKind: 'analyze' | 'ask' | 'stuck' | 'explain' | 'parse' | 'summarize';
  /** 题目（可选） */
  problem?: Problem;
  /** 代码字符数 */
  codeLength?: number;
  /** 代码行数 */
  codeLineCount?: number;
  /** ask 任务的问题文本长度 */
  questionLength?: number;
}

/** 路由决策 */
export interface RouteDecision {
  /** 是否走 fastLane（true = 本地，false = 主云端） */
  useFast: boolean;
  /** 决策理由（用于 UI 展示和 debug 日志） */
  reason: string;
  /** 用户可读的简短标签（"⚡ 本地" / "☁ 云端"） */
  label: string;
}

/**
 * 路由阈值（用户可在 Settings 里覆盖）。
 *
 * 默认值的依据：
 *   - codeCharLimit 4000 ≈ 1000 tokens，本地 qwen3.5:4b num_ctx 4096-20480 都装得下
 *   - codeLineLimit 120：超过这行数本地 ctx 容易爆
 *   - heavyTags：复杂主题需要长链推理，本地小模型容易翻车
 */
export interface RouterHints {
  /** 代码字符上限（超过 → 主云端） */
  codeCharLimit?: number;
  /** 代码行数上限 */
  codeLineLimit?: number;
  /** ask 任务问题文本字符上限 */
  questionCharLimit?: number;
  /** explain-paste 粘贴字符上限 */
  pasteCharLimit?: number;
  /** 命中其一即跳主云端的题目 tag 触发词 */
  heavyTags?: string[];
}

/** 默认阈值（用户没自定义时使用） */
export const DEFAULT_ROUTER_HINTS: Required<RouterHints> = {
  codeCharLimit: 4000,
  codeLineLimit: 120,
  questionCharLimit: 500,
  pasteCharLimit: 2000,
  heavyTags: [
    // 算法
    'DP', '动态规划', '动规',
    '图论', '最短路', '最小生成树', '强连通', '拓扑排序',
    '数论', '快速幂', '逆元', 'CRT', '中国剩余定理',
    '网络流', '最大流', '费用流', '匹配',
    '字符串', 'KMP', '后缀自动机', '后缀数组', 'AC自动机', 'Trie',
    '组合数学', '生成函数', '容斥', '矩阵',
    '计算几何', '凸包', '半平面交',
    // 数据结构
    '线段树', '可持久化', 'Splay', '平衡树', 'LCT', 'Link-Cut',
    '点分治', '树链剖分', '虚树', '树状数组',
    // 高级技巧
    '二分图', 'Tarjan', 'CDQ', '莫队',
  ],
};

/**
 * 路由决策主函数。
 *
 * @param hints       路由信号
 * @param fastEnabled fastLane 是否配置好（aiFast 客户端是否存在）
 * @param override    用户在 Settings 自定义的阈值（可选，未传则用 DEFAULT_ROUTER_HINTS）
 */
export function pickRoute(
  hints: RouteHints,
  fastEnabled: boolean,
  override?: RouterHints,
): RouteDecision {
  // ── 0) fastLane 没配 → 全部主 ─────────────────
  if (!fastEnabled) {
    return { useFast: false, reason: 'fastLane 未配置', label: '☁ 云端' };
  }

  // 合并阈值：用户配置 > 默认
  const codeCharLimit = override?.codeCharLimit ?? DEFAULT_ROUTER_HINTS.codeCharLimit;
  const codeLineLimit = override?.codeLineLimit ?? DEFAULT_ROUTER_HINTS.codeLineLimit;
  const pasteCharLimit = override?.pasteCharLimit ?? DEFAULT_ROUTER_HINTS.pasteCharLimit;
  const heavyTags =
    override?.heavyTags && override.heavyTags.length > 0
      ? override.heavyTags
      : DEFAULT_ROUTER_HINTS.heavyTags;

  // ── 1) 任务种类硬规则 ─────────────────
  switch (hints.taskKind) {
    case 'parse':
    case 'summarize':
      return {
        useFast: false,
        reason: '一次性高质量任务（题面解析 / 错题总结）',
        label: '☁ 云端',
      };
    case 'ask':
      return { useFast: false, reason: '问教练固定使用主云端模型', label: '☁ 云端' };
    case 'stuck':
      return { useFast: true, reason: '苏格拉底引导极短，本地最快', label: '⚡ 本地' };
    case 'explain':
      if ((hints.codeLength ?? 0) > pasteCharLimit) {
        return {
          useFast: false,
          reason: `粘贴片段 ${hints.codeLength} 字符 > ${pasteCharLimit}`,
          label: '☁ 云端',
        };
      }
      return { useFast: true, reason: '解释粘贴片段，本地够用', label: '⚡ 本地' };
  }

  // ── 2) analyze / ask：动态路由 ─────────────────

  // 代码过长 → 主
  const codeLen = hints.codeLength ?? 0;
  const codeLines = hints.codeLineCount ?? 0;
  if (codeLen > codeCharLimit) {
    return {
      useFast: false,
      reason: `代码 ${codeLen} 字符 > ${codeCharLimit}`,
      label: '☁ 云端',
    };
  }
  if (codeLines > codeLineLimit) {
    return {
      useFast: false,
      reason: `代码 ${codeLines} 行 > ${codeLineLimit}`,
      label: '☁ 云端',
    };
  }

  // 题目难度 hard → 主
  if (hints.problem?.difficulty === 'hard') {
    return { useFast: false, reason: '难题需要深度推理', label: '☁ 云端' };
  }

  // 题目 tag 命中复杂主题 → 主
  const tags = hints.problem?.tags ?? [];
  const hit = tags.find((t) => heavyTags.some((h) => t.includes(h)));
  if (hit) {
    return { useFast: false, reason: `复杂主题"${hit}"`, label: '☁ 云端' };
  }

  // ── 3) 默认 → fast ─────────────────
  return { useFast: true, reason: '简单场景，本地速度优先', label: '⚡ 本地' };
}
