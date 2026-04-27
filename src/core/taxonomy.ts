/**
 * 知识点分类体系（Knowledge Taxonomy）
 *
 * 按"年级"（学习进度）+ "学科"（知识结构）组织，给 AI 在错题分析时归类用。
 *
 * 主轴：算法 + 数据结构 + 编程语言（最常出错题）
 * 辅轴：操作系统/网络/数据库/编译原理（系统课，错题相对少）
 *
 * 参考国内主流 CS 培养方案（清华/北大/浙大/哈工大/上海大学）和经典教材：
 * - 大一：谭浩强《C 程序设计》、屈婉玲《离散数学》
 * - 大二：严蔚敏《数据结构（C 语言版）》、王晓东《算法设计与分析》、钱能《C++ 程序设计》
 * - 大三：汤子瀛《操作系统》、谢希仁《计算机网络》、王珊《数据库系统概论》、陈火旺《编译原理》
 * - 进阶/竞赛：CLRS《算法导论》、刘汝佳《算法竞赛入门经典》、《算法竞赛进阶指南》
 *
 * 用法：
 *   - prompts.ts 把这个表序列化到 system prompt，让 AI 在错题分析里选 1-2 个 areaCode
 *   - Mistake.areaCodes 字段保存命中的分类
 *   - 错题本按年级 / 学科分组展示
 *   - LearnerProfile 按 areaCode 统计薄弱点
 */

export type Grade = 'Y1' | 'Y2' | 'Y3' | 'Y4';

export interface KnowledgeArea {
  /** 唯一代码，形如 'Y2.ds.tree' */
  code: string;
  /** 年级 */
  grade: Grade;
  /** 学科簇：lang/ds/alg/math/sys */
  cluster: 'lang' | 'ds' | 'alg' | 'math' | 'sys';
  /** 显示名（中文） */
  name: string;
  /** 简短说明，给 AI 看的 */
  description: string;
  /** 主流参考教材 */
  textbooks?: string[];
  /** 关键词，AI 在归类时可对照 */
  keywords: string[];
}

export const TAXONOMY: KnowledgeArea[] = [
  // ═══════════════════════ 大一 Year 1 ═══════════════════════
  // 语言基础
  {
    code: 'Y1.lang.basics',
    grade: 'Y1',
    cluster: 'lang',
    name: '语法基础',
    description: 'C/Python 语法、变量、类型、控制流',
    textbooks: ['谭浩强《C 程序设计》', '浙大《C 语言程序设计》'],
    keywords: ['变量', '类型转换', 'if-else', 'while/for', '运算符'],
  },
  {
    code: 'Y1.lang.io',
    grade: 'Y1',
    cluster: 'lang',
    name: '输入输出',
    description: 'scanf/printf 格式串、cin/cout、文件读写、缓冲',
    keywords: ['scanf', 'printf', '%d/%lld', '换行', 'getline', 'sync_with_stdio'],
  },
  {
    code: 'Y1.lang.func',
    grade: 'Y1',
    cluster: 'lang',
    name: '函数与递归',
    description: '函数定义、参数传递、递归思想、栈帧',
    keywords: ['函数', '递归', '栈溢出', '尾递归', '参数传值', '指针传参'],
  },
  {
    code: 'Y1.lang.array',
    grade: 'Y1',
    cluster: 'lang',
    name: '数组与字符串',
    description: '数组下标、C 字符串、二维数组',
    keywords: ['数组越界', 'strlen', 'strcpy', "字符串结尾 '\\0'", '二维数组'],
  },
  {
    code: 'Y1.lang.pointer',
    grade: 'Y1',
    cluster: 'lang',
    name: '指针与内存',
    description: 'C 指针、地址运算、malloc/free',
    keywords: ['指针', 'NULL', 'malloc', 'free', '内存泄漏', '野指针', '段错误'],
  },
  {
    code: 'Y1.lang.struct',
    grade: 'Y1',
    cluster: 'lang',
    name: '结构体与位运算',
    description: 'struct、union、文件 IO、位运算',
    keywords: ['struct', 'union', 'fopen', '位运算', '<<', '&|^'],
  },
  // 算法入门
  {
    code: 'Y1.alg.simulate',
    grade: 'Y1',
    cluster: 'alg',
    name: '模拟与枚举',
    description: '简单模拟、暴力枚举、日期/进制类',
    keywords: ['枚举', '模拟', '日期', '进制转换', '质数判定', '欧几里得'],
  },
  {
    code: 'Y1.alg.sort_basic',
    grade: 'Y1',
    cluster: 'alg',
    name: '基础排序',
    description: '冒泡/选择/插入，O(n²) 排序与复杂度入门',
    keywords: ['冒泡', '选择排序', '插入排序', 'O(n²)'],
  },
  {
    code: 'Y1.alg.binary_search',
    grade: 'Y1',
    cluster: 'alg',
    name: '二分查找',
    description: '二分查找、二分答案、边界处理',
    keywords: ['二分', 'lower_bound', '二分答案', 'mid 越界'],
  },
  // 数学
  {
    code: 'Y1.math.discrete',
    grade: 'Y1',
    cluster: 'math',
    name: '离散数学',
    description: '集合/逻辑/关系/函数/组合数学',
    textbooks: ['屈婉玲《离散数学》'],
    keywords: ['集合', '关系', '命题逻辑', '组合', '排列'],
  },

  // ═══════════════════════ 大二 Year 2 ═══════════════════════
  // 数据结构
  {
    code: 'Y2.ds.list',
    grade: 'Y2',
    cluster: 'ds',
    name: '线性表',
    description: '数组、单/双链表、栈、队列、deque',
    textbooks: ['严蔚敏《数据结构》第 2-3 章'],
    keywords: ['链表', '栈', '队列', 'deque', '环形队列', '链表反转'],
  },
  {
    code: 'Y2.ds.string',
    grade: 'Y2',
    cluster: 'ds',
    name: '字符串',
    description: 'KMP、Manacher、Trie、字符串哈希',
    textbooks: ['严蔚敏 第 4 章'],
    keywords: ['KMP', 'next 数组', 'Manacher', 'Trie', '字符串哈希'],
  },
  {
    code: 'Y2.ds.tree',
    grade: 'Y2',
    cluster: 'ds',
    name: '树与堆',
    description: '二叉树/BST/堆/Huffman/并查集',
    textbooks: ['严蔚敏 第 6 章'],
    keywords: ['二叉树', '前中后序', 'BST', '堆', '并查集', 'Huffman'],
  },
  {
    code: 'Y2.ds.graph',
    grade: 'Y2',
    cluster: 'ds',
    name: '图（基础）',
    description: '邻接表/BFS/DFS/拓扑/最短路/MST',
    textbooks: ['严蔚敏 第 7 章'],
    keywords: ['邻接表', 'BFS', 'DFS', '拓扑排序', 'Dijkstra', 'Floyd', 'Kruskal', 'Prim'],
  },
  {
    code: 'Y2.ds.hash',
    grade: 'Y2',
    cluster: 'ds',
    name: '散列',
    description: '哈希表、冲突解决、unordered_map',
    textbooks: ['严蔚敏 第 8 章'],
    keywords: ['哈希冲突', '开放定址', '链地址', '负载因子', 'unordered_map'],
  },
  {
    code: 'Y2.ds.sort_advance',
    grade: 'Y2',
    cluster: 'ds',
    name: '高级排序',
    description: '快排/归并/堆排序、计数/桶/基数',
    textbooks: ['严蔚敏 第 9 章'],
    keywords: ['快排', '归并', '堆排序', '稳定性', '基数排序', '逆序对'],
  },
  {
    code: 'Y2.ds.advanced',
    grade: 'Y2',
    cluster: 'ds',
    name: '高级数据结构',
    description: '线段树/树状数组/单调栈/单调队列',
    keywords: ['线段树', '树状数组', '单调栈', '单调队列', 'lazy 标记'],
  },
  // 算法
  {
    code: 'Y2.alg.dnc',
    grade: 'Y2',
    cluster: 'alg',
    name: '分治',
    description: '二分/归并/快选、主定理、CDQ',
    textbooks: ['CLRS 第 4 章'],
    keywords: ['分治', '主定理', 'CDQ 分治', '快速选择'],
  },
  {
    code: 'Y2.alg.greedy',
    grade: 'Y2',
    cluster: 'alg',
    name: '贪心',
    description: '贪心策略、反悔贪心、霍夫曼',
    keywords: ['贪心', '反悔贪心', '区间调度', 'Huffman'],
  },
  {
    code: 'Y2.alg.dp',
    grade: 'Y2',
    cluster: 'alg',
    name: '动态规划（基础）',
    description: '线性 dp、背包、区间 dp、状态设计',
    textbooks: ['CLRS 第 15 章'],
    keywords: ['线性 dp', '01 背包', '完全背包', 'LIS', 'LCS', '区间 dp'],
  },
  {
    code: 'Y2.alg.search',
    grade: 'Y2',
    cluster: 'alg',
    name: '搜索',
    description: 'DFS/BFS、剪枝、记忆化、双向 BFS',
    keywords: ['DFS', 'BFS', '剪枝', '记忆化', 'IDA*', '双向 BFS'],
  },
  // C++ 进阶
  {
    code: 'Y2.lang.cpp_oop',
    grade: 'Y2',
    cluster: 'lang',
    name: 'C++ 面向对象',
    description: '类/继承/多态/模板/STL',
    textbooks: ['钱能《C++ 程序设计教程》', '郑莉《C++ 语言程序设计》'],
    keywords: ['class', '虚函数', '模板', 'STL', 'vector', 'map', '迭代器失效'],
  },
  {
    code: 'Y2.lang.pitfall',
    grade: 'Y2',
    cluster: 'lang',
    name: '语言陷阱',
    description: '溢出/UB/精度/未初始化',
    keywords: ['整数溢出', 'long long', '未初始化', 'UB', '浮点精度', '运算符优先级'],
  },

  // ═══════════════════════ 大三 Year 3 ═══════════════════════
  // 算法进阶
  {
    code: 'Y3.alg.dp_advance',
    grade: 'Y3',
    cluster: 'alg',
    name: 'DP 进阶',
    description: '树形/状压/数位/概率 dp、斜率优化、决策单调',
    textbooks: ['《算法竞赛进阶指南》'],
    keywords: ['树形 dp', '状压 dp', '数位 dp', '概率 dp', '斜率优化', '决策单调性'],
  },
  {
    code: 'Y3.alg.graph_advance',
    grade: 'Y3',
    cluster: 'alg',
    name: '图论进阶',
    description: '网络流/SCC/2-SAT/二分图/欧拉路径',
    textbooks: ['CLRS 第 26 章'],
    keywords: ['网络流', '最大流', '最小割', 'SCC', 'Tarjan', '2-SAT', '匈牙利', 'KM'],
  },
  {
    code: 'Y3.alg.string_advance',
    grade: 'Y3',
    cluster: 'alg',
    name: '字符串进阶',
    description: 'AC 自动机、SAM、SA、回文树',
    keywords: ['AC 自动机', 'SAM', '后缀数组', '回文自动机'],
  },
  {
    code: 'Y3.alg.number',
    grade: 'Y3',
    cluster: 'math',
    name: '数论',
    description: '快速幂/欧拉/费马/CRT/逆元/FFT',
    keywords: ['快速幂', '欧拉定理', 'CRT', '逆元', 'FFT', 'NTT', '莫比乌斯反演'],
  },
  {
    code: 'Y3.alg.geom',
    grade: 'Y3',
    cluster: 'alg',
    name: '计算几何',
    description: '凸包/扫描线/半平面交/旋转卡壳',
    keywords: ['凸包', '叉积', '扫描线', '半平面交', '旋转卡壳'],
  },
  // 系统课
  {
    code: 'Y3.sys.os',
    grade: 'Y3',
    cluster: 'sys',
    name: '操作系统',
    description: '进程/线程/内存/文件系统/并发原语',
    textbooks: ['汤子瀛《计算机操作系统》', '《操作系统：精髓与设计原理》'],
    keywords: ['进程', '线程', '互斥锁', '信号量', '死锁', '页表', '调度', '虚拟内存'],
  },
  {
    code: 'Y3.sys.network',
    grade: 'Y3',
    cluster: 'sys',
    name: '计算机网络',
    description: 'TCP/IP/HTTP/socket 编程',
    textbooks: ['谢希仁《计算机网络》'],
    keywords: ['TCP', 'UDP', 'HTTP', 'socket', '三次握手', 'DNS'],
  },
  {
    code: 'Y3.sys.db',
    grade: 'Y3',
    cluster: 'sys',
    name: '数据库原理',
    description: 'SQL/关系代数/事务/索引/范式',
    textbooks: ['王珊《数据库系统概论》'],
    keywords: ['SQL', 'JOIN', '事务', 'ACID', '索引', 'B+ 树', '范式'],
  },
  {
    code: 'Y3.sys.compiler',
    grade: 'Y3',
    cluster: 'sys',
    name: '编译原理',
    description: '词法/语法/语义/代码生成',
    textbooks: ['陈火旺《程序设计语言编译原理》', '龙书 Compilers'],
    keywords: ['词法分析', '语法分析', 'LL', 'LR', 'AST', '语义'],
  },
  {
    code: 'Y3.sys.arch',
    grade: 'Y3',
    cluster: 'sys',
    name: '计算机组成 / 系统结构',
    description: '指令集/流水线/缓存/MIPS',
    textbooks: ['唐朔飞《计算机组成原理》'],
    keywords: ['指令集', '流水线', '缓存', 'cache', 'MIPS'],
  },

  // ═══════════════════════ 大四 Year 4 ═══════════════════════
  {
    code: 'Y4.advanced.parallel',
    grade: 'Y4',
    cluster: 'sys',
    name: '并发与并行',
    description: '多线程编程/锁/原子/内存模型',
    keywords: ['mutex', 'atomic', '内存模型', '无锁'],
  },
  {
    code: 'Y4.advanced.distributed',
    grade: 'Y4',
    cluster: 'sys',
    name: '分布式系统',
    description: '一致性/Paxos/Raft/CAP',
    keywords: ['CAP', 'Paxos', 'Raft', '一致性', '分布式锁'],
  },
  {
    code: 'Y4.advanced.ml',
    grade: 'Y4',
    cluster: 'alg',
    name: '机器学习基础',
    description: '线性回归/分类/神经网络',
    keywords: ['梯度下降', '过拟合', '激活函数', '反向传播'],
  },
];

// ════ 辅助函数 ════

const byCode = new Map(TAXONOMY.map((a) => [a.code, a]));

export function getArea(code: string): KnowledgeArea | undefined {
  return byCode.get(code);
}

export function listByGrade(grade: Grade): KnowledgeArea[] {
  return TAXONOMY.filter((a) => a.grade === grade);
}

/**
 * 序列化给 AI 看的 enum 列表（节省 token，只放 code+name+keywords 摘要）
 */
export function serializeForPrompt(): string {
  const lines: string[] = [];
  for (const grade of ['Y1', 'Y2', 'Y3', 'Y4'] as Grade[]) {
    const items = listByGrade(grade);
    if (items.length === 0) continue;
    lines.push(`【${grade}】`);
    for (const a of items) {
      lines.push(`  - ${a.code}: ${a.name} — ${a.keywords.slice(0, 5).join('/')}`);
    }
  }
  return lines.join('\n');
}

/** 学生当前所在年级（默认大一）— 后续可放到设置里 */
export const DEFAULT_LEARNER_GRADE: Grade = 'Y1';
