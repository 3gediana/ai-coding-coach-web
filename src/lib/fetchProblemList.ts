/**
 * 实时从 OJ 抓取题目列表（不内置数据）。带 localStorage 缓存：
 *   - 每个 site 独立 key，按页存
 *   - 抓取成功的页 merge 进去；抓失败下次重试
 *   - 下次打开时立刻显示缓存，后台静默更新
 *
 * 4 个支持的 OJ：
 *   - 洛谷：JSON API（最稳）
 *   - AtCoder：从 kenkoooo 社区聚合 JSON 拿全量（每周更新一次）
 *   - POJ：HTML 表格按 volume 翻页
 *   - HDU：HTML 表格按 vol 翻页
 *
 * 客户端调 fetch('/problem-fetch?url=...') 走 vite dev middleware 代理（绕 CORS）
 */
import { safeGetItem, safeRemoveItem, safeSetItem } from './safeLocalStorage';

export type ListItem = {
  pid: string;
  title: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  difficultyRaw?: number | string;  // 原始难度（不同 OJ 含义不同）
  tags?: string[];
  url: string;
};

export type ListSite = 'luogu' | 'atcoder' | 'poj' | 'hdu';

export type ListPage = {
  site: ListSite;
  items: ListItem[];
  page: number;          // 1-indexed
  totalPages?: number;   // 不一定知道
  totalCount?: number;   // 全站题目数
};

const PROXY = (u: string) =>
  `/problem-fetch?url=${encodeURIComponent(u)}&ua=${encodeURIComponent(
    // 洛谷强反爬：必须用非浏览器 UA。其他站可用浏览器 UA。
    u.includes('luogu.com.cn') ? 'curl/8.0' : 'Mozilla/5.0',
  )}`;

async function proxyFetchText(url: string, signal?: AbortSignal): Promise<string> {
  const r = await fetch(PROXY(url), { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

async function proxyFetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const text = await proxyFetchText(url, signal);
  try { return JSON.parse(text) as T; }
  catch { throw new Error('返回非 JSON：' + text.slice(0, 200)); }
}

// ───── 洛谷：官方 JSON API ─────
//
// https://www.luogu.com.cn/problem/list?_contentOnly=1&page=N&type=P
// 返回 { currentData: { problems: { result: [...], count, perPage } } }
// 每条：{ pid, title, difficulty (0-7), tags: [int], totalSubmit, totalAccepted, type }
const LUOGU_DIFFICULTY: Record<number, 'easy' | 'medium' | 'hard'> = {
  0: 'easy',    // 暂无评定
  1: 'easy',    // 入门
  2: 'easy',    // 普及-
  3: 'medium',  // 普及/提高-
  4: 'medium',  // 普及+/提高
  5: 'medium',  // 提高+/省选-
  6: 'hard',    // 省选/NOI-
  7: 'hard',    // NOI/NOI+/CTSC
};

async function fetchLuoguList(page: number, signal?: AbortSignal): Promise<ListPage> {
  // 洛谷现在 SSR HTML，数据嵌在 <script id="lentille-context" type="application/json">
  const u = `https://www.luogu.com.cn/problem/list?page=${page}&type=P`;
  const html = await proxyFetchText(u, signal);
  const m = html.match(/<script[^>]*id=["']lentille-context["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('洛谷未找到 lentille-context（页面结构变化或被重定向）');
  let data: any;
  try { data = JSON.parse(m[1]); }
  catch (e) { throw new Error('洛谷 JSON 解析失败: ' + (e as any)?.message); }
  const node = data?.data?.problems;
  if (!node?.result) throw new Error('洛谷响应结构异常（无 problems.result）');

  const items: ListItem[] = node.result.map((p: any) => ({
    pid: p.pid,
    title: p.title,
    difficulty: LUOGU_DIFFICULTY[p.difficulty] ?? 'medium',
    difficultyRaw: p.difficulty,
    tags: undefined,
    url: `https://www.luogu.com.cn/problem/${p.pid}`,
  }));

  const perPage = node.perPage ?? 50;
  const totalCount = node.count ?? items.length;
  return {
    site: 'luogu',
    items,
    page,
    totalPages: Math.ceil(totalCount / perPage),
    totalCount,
  };
}

// ───── AtCoder：用 kenkoooo 社区聚合（含中国地区都能直连） ─────
//
// https://kenkoooo.com/atcoder/resources/problems.json   全量题目（含 contest_id 和 problem_id）
// https://kenkoooo.com/atcoder/resources/problem-models.json  题目难度评级
// 但 kenkoooo 不在我们的 ALLOWED_HOSTS 里，要走另一种方式。
//
// 改方案：直接抓 atcoder.jp 比赛归档 https://atcoder.jp/contests/archive
// 结合每个 contest 的 tasks 页太重；折中：抓 contest 归档 → 用户选 contest → 拉该 contest 题目
async function fetchAtcoderList(page: number, signal?: AbortSignal): Promise<ListPage> {
  // archive URL：https://atcoder.jp/contests/archive?lang=ja&page=N&category=0  (algo)
  const u = `https://atcoder.jp/contests/archive?lang=ja&page=${page}`;
  const html = await proxyFetchText(u, signal);

  // 只取 ABC 比赛（最初学适合），过滤 ARC/AGC/AHC/JOI 等
  // archive 表格里每行：<a href="/contests/abc356">AtCoder Beginner Contest 356</a>
  const contestRe = /<a[^>]+href="\/contests\/(abc\d+)"[^>]*>([^<]+)<\/a>/gi;
  const contests: { id: string; title: string }[] = [];
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = contestRe.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    contests.push({ id, title: m[2].trim() });
  }
  // 每个 ABC 假定 7 题（A-G），构造 items。点击时调 fetchAndParseProblem 拿真题面（标题会被替换）
  const items: ListItem[] = contests.flatMap((c) =>
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((sub) => ({
      pid: `${c.id}_${sub}`,
      title: `${c.id.toUpperCase()} · ${sub.toUpperCase()}`,
      url: `https://atcoder.jp/contests/${c.id}/tasks/${c.id}_${sub}`,
    })),
  );

  return { site: 'atcoder', items, page };
}

// ───── POJ：HTML 表格 ─────
//
// http://poj.org/problemlist?volume=N（每页 100 题）
async function fetchPojList(page: number, signal?: AbortSignal): Promise<ListPage> {
  const u = `http://poj.org/problemlist?volume=${page}`;
  const html = await proxyFetchText(u, signal);

  // POJ 行格式（注意属性无引号）：
  // <tr align=center><td>1000</td><td align=left><a lang="en-US" href=problem?id=1000>A+B Problem</a></td>...
  const rowRe = /<tr\s+align=center>([\s\S]*?)<\/tr>/gi;
  const items: ListItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html))) {
    const row = m[1];
    const idMatch = row.match(/<td[^>]*>(\d{4,})<\/td>/);
    const titleMatch = row.match(/<a[^>]*href=problem\?id=\d+[^>]*>([\s\S]*?)<\/a>/);
    if (!idMatch || !titleMatch) continue;
    const pid = idMatch[1];
    items.push({
      pid,
      title: titleMatch[1].replace(/<[^>]+>/g, '').trim(),
      url: `http://poj.org/problem?id=${pid}`,
    });
  }

  // POJ 题号大致到 4000+，每页 100 题，约 40 页
  return { site: 'poj', items, page, totalPages: 40 };
}

// ───── HDU：HTML 表格 ─────
//
// https://acm.hdu.edu.cn/listproblem.php?vol=N（每页 100 题）
async function fetchHduList(page: number, signal?: AbortSignal): Promise<ListPage> {
  const u = `https://acm.hdu.edu.cn/listproblem.php?vol=${page}`;
  const html = await proxyFetchText(u, signal);

  // HDU 用 JS 数组：p(color, pid, solved, title, ac, sub)。title 是双引号。
  // 例：p(0,1000,-1,"A + B Problem",338326,1148527);
  const re = /p\((\d+),(\d+),(-?\d+),"([^"]*?)",(\d+),(\d+)\)/g;
  const items: ListItem[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const pid = m[2];
    items.push({
      pid,
      title: m[4].trim(),
      url: `https://acm.hdu.edu.cn/showproblem.php?pid=${pid}`,
    });
  }

  // HDU 题号到 7000+，每页 100，约 70 页
  return { site: 'hdu', items, page, totalPages: 70 };
}

// ───── 统一入口 ─────
const FETCHERS: Record<ListSite, (p: number, sig?: AbortSignal) => Promise<ListPage>> = {
  luogu: fetchLuoguList,
  atcoder: fetchAtcoderList,
  poj: fetchPojList,
  hdu: fetchHduList,
};

export async function fetchProblemListPage(
  site: ListSite,
  page: number,
  signal?: AbortSignal,
): Promise<ListPage> {
  return FETCHERS[site](page, signal);
}

// ───── 缓存层（localStorage） ─────

type CacheEntry = {
  items: Record<string, ListItem>;  // pid -> item
  fetchedPages: number[];           // 抓过的页号（去重）
  totalPages?: number;
  totalCount?: number;
  lastFetchedAt: number;
};

const CACHE_KEY = (site: ListSite) => `aicc.problemList.${site}.v1`;

export function loadListCache(site: ListSite): CacheEntry | null {
  try {
    const raw = safeGetItem(CACHE_KEY(site));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveListCache(site: ListSite, entry: CacheEntry): void {
  try {
    safeSetItem(CACHE_KEY(site), JSON.stringify(entry));
  } catch (e) {
    console.warn('list cache save failed', e);
  }
}

/** 把一页抓取结果合并进缓存，返回更新后的 entry */
export function mergeListPage(site: ListSite, page: ListPage): CacheEntry {
  const old = loadListCache(site) ?? {
    items: {},
    fetchedPages: [],
    lastFetchedAt: 0,
  };
  const next: CacheEntry = {
    items: { ...old.items },
    fetchedPages: Array.from(new Set([...old.fetchedPages, page.page])).sort((a, b) => a - b),
    totalPages: page.totalPages ?? old.totalPages,
    totalCount: page.totalCount ?? old.totalCount,
    lastFetchedAt: Date.now(),
  };
  for (const it of page.items) {
    next.items[it.pid] = it;
  }
  saveListCache(site, next);
  return next;
}

export function clearListCache(site: ListSite): void {
  safeRemoveItem(CACHE_KEY(site));
}

/** 缓存里的全部题目按 pid 排序输出 */
export function getCachedItems(site: ListSite): ListItem[] {
  const c = loadListCache(site);
  if (!c) return [];
  // 数字 pid 按数字排，字符串 pid 按字典
  const arr = Object.values(c.items);
  arr.sort((a, b) => {
    const na = parseInt(a.pid.replace(/\D/g, ''), 10);
    const nb = parseInt(b.pid.replace(/\D/g, ''), 10);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.pid.localeCompare(b.pid);
  });
  return arr;
}
