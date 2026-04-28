/**
 * 从 OJ 题目 URL 抓取并解析题面。
 *
 * ── 设计 ──
 * 浏览器侧不能直接 fetch 跨域 OJ（CORS），所以走 dev/prod 的 /problem-fetch 代理。
 * 代理还负责定制 User-Agent（洛谷必须用非浏览器 UA，否则陷 cookie redirect 死循环）。
 *
 * ── 支持矩阵（实测 2026.04） ──
 *   ✓ 洛谷       www.luogu.com.cn/problem/P****
 *   ✓ AtCoder    atcoder.jp/contests/{contest}/tasks/{task}
 *   ✓ POJ        poj.org/problem?id=****
 *   ✓ HDU        acm.hdu.edu.cn/showproblem.php?pid=****
 *   ✗ Codeforces 403 反爬（需要 Cloudflare 通过方案）
 *   ✗ LeetCode   SPA + 反爬
 *   ✗ 牛客       SPA + 反爬
 *
 * ── 输出 ──
 * 标准化为 ProblemDraft，与 ProblemEditorModal 共享类型。
 */

import type { ProblemExample } from '../core/types';

type ParsedProblemExamples = ProblemExample[];

/** 解析后的题目草稿（可直接喂给 ProblemEditorModal 或 store.addProblem） */
export interface FetchedProblem {
  title: string;
  statement: string;
  constraints?: string;
  examples?: ParsedProblemExamples;
  tags?: string[];
  difficulty?: string;
  source: { site: string; url: string; pid?: string };
  /** 原始 HTML 长度 + 抓取耗时，用于诊断 */
  meta?: { htmlLen: number; ms: number };
}

/** 
 * site 识别结果：
 * - 可抓的站：luogu / atcoder / poj / hdu
 * - 已知不可抓的站：unsupported-cf / unsupported-leetcode / unsupported-nowcoder
 *   （改造不需要代码变动，给 UI 提示针对性的【复制题面】引导）
 * - 其他任意 URL：unsupported
 */
export type SiteKey =
  | 'luogu' | 'atcoder' | 'poj' | 'hdu'
  | 'unsupported-cf' | 'unsupported-leetcode' | 'unsupported-nowcoder'
  | 'unsupported';

export class FetchProblemError extends Error {
  code: 'unsupported' | 'network' | 'parse' | 'blocked';
  constructor(code: 'unsupported' | 'network' | 'parse' | 'blocked', msg: string) {
    super(msg);
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────
// 主入口
// ─────────────────────────────────────────────────────────────

export function detectSite(url: string): { site: SiteKey; pid?: string } {
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase();
    if (host === 'www.luogu.com.cn' || host === 'luogu.com.cn') {
      const m = u.pathname.match(/\/problem\/([A-Za-z0-9]+)/);
      return { site: 'luogu', pid: m?.[1] };
    }
    if (host === 'atcoder.jp') {
      const m = u.pathname.match(/\/contests\/[^/]+\/tasks\/([^/?#]+)/);
      return { site: 'atcoder', pid: m?.[1] };
    }
    if (host === 'poj.org') {
      const m = u.search.match(/[?&]id=(\d+)/);
      return { site: 'poj', pid: m?.[1] };
    }
    if (host === 'acm.hdu.edu.cn') {
      const m = u.search.match(/[?&]pid=(\d+)/);
      return { site: 'hdu', pid: m?.[1] };
    }
    // 已知不能抓的站 — 识别出来给 UI 针对性提示
    if (host === 'codeforces.com' || host === 'www.codeforces.com' || host.endsWith('.codeforces.com')) {
      const m = u.pathname.match(/\/(?:problemset\/problem|contest\/\d+\/problem)\/(\d+)\/?([A-Z]\d?)?/i);
      const pid = m ? `${m[1]}${m[2] ?? ''}` : undefined;
      return { site: 'unsupported-cf', pid };
    }
    if (host === 'leetcode.com' || host === 'leetcode.cn') {
      const m = u.pathname.match(/\/problems\/([^/]+)/);
      return { site: 'unsupported-leetcode', pid: m?.[1] };
    }
    if (host === 'ac.nowcoder.com' || host === 'nowcoder.com' || host.endsWith('.nowcoder.com')) {
      const m = u.pathname.match(/\/(?:acm\/problem|practice|questionTerminal)\/([A-Za-z0-9]+)/);
      return { site: 'unsupported-nowcoder', pid: m?.[1] };
    }
    return { site: 'unsupported' };
  } catch {
    return { site: 'unsupported' };
  }
}

/** 判断是否是可抓的站点 */
export function isFetchableSite(s: SiteKey): boolean {
  return s === 'luogu' || s === 'atcoder' || s === 'poj' || s === 'hdu';
}

/** 通过 /problem-fetch 代理拿 HTML（必要时定制 UA），带超时和 cancel 支持 */
async function proxyFetch(
  targetUrl: string,
  opts?: { ua?: string; timeoutMs?: number; signal?: AbortSignal },
): Promise<string> {
  const u = `/problem-fetch?url=${encodeURIComponent(targetUrl)}${opts?.ua ? `&ua=${encodeURIComponent(opts.ua)}` : ''}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 12_000);
  // 联动外部 signal
  const onExternalAbort = () => ctrl.abort();
  opts?.signal?.addEventListener('abort', onExternalAbort);
  try {
    const r = await fetch(u, { signal: ctrl.signal });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); msg = j?.error || msg; } catch { /* */ }
      throw new FetchProblemError(
        r.status === 403 || r.status === 451 ? 'blocked' : 'network',
        msg,
      );
    }
    return await r.text();
  } catch (e: any) {
    if (e instanceof FetchProblemError) throw e;
    if (e?.name === 'AbortError') {
      throw new FetchProblemError('network', '超时（>12s）或被取消，请检查网络后重试');
    }
    throw new FetchProblemError('network', String(e?.message || e));
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function fetchAndParseProblem(
  url: string,
  opts?: { signal?: AbortSignal; timeoutMs?: number },
): Promise<FetchedProblem> {
  const t0 = Date.now();
  const { site, pid } = detectSite(url);
  if (!isFetchableSite(site)) {
    // 识别出具体不支持站点时，给出针对性提示
    const msg = (
      site === 'unsupported-cf'      ? 'Codeforces 反爬严格，服务端拼 HTTP 拿不到题面。请打开 CF 题面页 → 全选复制 → 粘到下方文本框，AI 会解析。'
      : site === 'unsupported-leetcode' ? 'LeetCode 是 SPA 页面，HTML 是空壳。请打开题目页 → 复制题面 + 示例 → 粘到下方文本框。'
      : site === 'unsupported-nowcoder' ? '牛客需要登录 + JS 渲染，服务端拿不到。请复制题面到下方。'
      : '不识别该站。目前只支持 洛谷 / AtCoder / POJ / HDU 自动抓取。其他站请复制题面。'
    );
    throw new FetchProblemError('unsupported', msg);
  }

  let html: string;
  let parsed: FetchedProblem;
  const fetchOpts = { signal: opts?.signal, timeoutMs: opts?.timeoutMs };
  switch (site) {
    case 'luogu':
      // 洛谷必须用非浏览器 UA（关键发现）
      html = await proxyFetch(url, { ua: 'node', ...fetchOpts });
      parsed = parseLuogu(html, url, pid);
      break;
    case 'atcoder':
      html = await proxyFetch(url, fetchOpts);
      parsed = parseAtCoder(html, url, pid);
      break;
    case 'poj':
      html = await proxyFetch(url, fetchOpts);
      parsed = parsePOJ(html, url, pid);
      break;
    case 'hdu':
      html = await proxyFetch(url, fetchOpts);
      parsed = parseHDU(html, url, pid);
      break;
    default:
      throw new FetchProblemError('unsupported', '未实现该站点的解析');
  }
  parsed.meta = { htmlLen: html.length, ms: Date.now() - t0 };
  return parsed;
}

// ─────────────────────────────────────────────────────────────
// 各站点解析器
// ─────────────────────────────────────────────────────────────

/**
 * 洛谷：题面在 <script id="lentille-context">{...}</script> JSON 里。
 * 路径：data.problem.contenu.{description,formatI,formatO,hint}
 *      data.problem.{title,samples,limits,tags}
 * Markdown + LaTeX（$...$）原样保留，KaTeX 渲染端会处理。
 */
function parseLuogu(html: string, url: string, pid?: string): FetchedProblem {
  const m = html.match(/<script id="lentille-context"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new FetchProblemError('parse', '未找到 lentille-context（洛谷页面结构可能变了）');
  let json: any;
  try { json = JSON.parse(m[1]); } catch { throw new FetchProblemError('parse', 'lentille-context JSON 解析失败'); }
  const p = json?.data?.problem;
  if (!p) throw new FetchProblemError('parse', 'JSON 里没有 problem 字段');

  const c = p.contenu || p.content || {};
  const title = `${p.pid ?? pid ?? ''} ${p.title ?? ''}`.trim() || `洛谷题目 ${pid}`;

  // 拼 statement
  const parts: string[] = [];
  if (c.background) parts.push(c.background.trim());
  if (c.description) parts.push(c.description.trim());
  if (c.formatI) parts.push(`## 输入格式\n\n${c.formatI.trim()}`);
  if (c.formatO) parts.push(`## 输出格式\n\n${c.formatO.trim()}`);
  if (c.hint) parts.push(`## 说明 / 提示\n\n${c.hint.trim()}`);
  const statement = parts.join('\n\n');
  if (!statement) {
    throw new FetchProblemError('parse', '洛谷题面正文为空（可能这道题需要登录后才能查看）');
  }

  // samples
  const examples: ParsedProblemExamples =
    Array.isArray(p.samples)
      ? p.samples.map((s: any[]) => ({ input: s?.[0] ?? '', output: s?.[1] ?? '' }))
      : [];

  // limits → constraints
  let constraints: string | undefined;
  if (p.limits?.time?.length) {
    const time = Math.max(...p.limits.time);
    const mem = Math.max(...(p.limits.memory ?? [0]));
    constraints = `时间限制：${time} ms · 内存限制：${Math.round(mem / 1024)} MB`;
  }

  return {
    title,
    statement,
    constraints,
    examples,
    difficulty: typeof p.difficulty === 'number' ? `难度 ${p.difficulty}` : undefined,
    source: { site: 'luogu', url, pid: p.pid ?? pid },
  };
}

/**
 * AtCoder：<div id="task-statement"> 里有 lang-en 和 lang-ja 两段。
 * 章节结构：<h3>Title</h3> 之后到下一个 <h3> 之前是该章节内容。
 * 样例输入/输出在 <pre>...</pre> 里（h3 同段）。
 * 含 MathJax 公式（\(...\) / \[...\]），转成 KaTeX 兼容（统一 $ ... $）。
 */
function parseAtCoder(html: string, url: string, pid?: string): FetchedProblem {
  // 标题：<span class="h2">A - Happy Birthday!\n\t\t\t<a>Editorial</a>...</span>
  // 取第一行（"A - Title"），去掉残留按钮
  const titleM = html.match(/<span class="h2">\s*([\s\S]*?)<\/span>/);
  let title = titleM ? stripHtml(titleM[1]) : `AtCoder ${pid}`;
  title = (title.split(/\r?\n/).map((s) => s.trim()).find(Boolean) ?? title)
    .replace(/\s*Editorial\s*$/i, '')
    .trim();

  // 优先 lang-en；fallback lang-ja；再 fallback 整个 task-statement
  let body: string | null = null;
  const en = html.match(/<span class="lang-en">([\s\S]*?)<\/span>\s*<\/div>\s*<\/div>/);
  const ja = html.match(/<span class="lang-ja">([\s\S]*?)<\/span>\s*<\/div>\s*<\/div>/);
  if (en) body = en[1];
  else if (ja) body = ja[1];
  if (!body) {
    const tsm = html.match(/<div id="task-statement">([\s\S]*?)<\/div>\s*<\/div>/);
    body = tsm?.[1] ?? null;
  }
  if (!body) throw new FetchProblemError('parse', '未找到 task-statement 内容（AtCoder 结构可能变了）');

  // 按 <h3> 切分：每段从该 h3 之后到下一个 h3 之前
  const headers = [...body.matchAll(/<h3>([\s\S]*?)<\/h3>/g)];
  if (headers.length === 0) {
    // 极端 fallback：整段拍平
    return {
      title,
      statement: mathjaxToKatex(stripHtml(body)).trim(),
      examples: [],
      source: { site: 'atcoder', url, pid },
    };
  }

  type Seg = { header: string; rawContent: string };
  const segments: Seg[] = [];
  for (let i = 0; i < headers.length; i++) {
    const header = stripHtml(headers[i][1]).trim();
    const start = (headers[i].index ?? 0) + headers[i][0].length;
    const end = i + 1 < headers.length ? (headers[i + 1].index ?? body.length) : body.length;
    segments.push({ header, rawContent: body.slice(start, end) });
  }

  const samples: ParsedProblemExamples = [];
  const parts: string[] = [];
  let curIn = '';

  for (const { header, rawContent } of segments) {
    if (/^Sample\s*Input/i.test(header) || /^入力例/.test(header)) {
      const preM = rawContent.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
      curIn = preM ? unescapeHtml(stripHtml(preM[1])).trim() : '';
    } else if (/^Sample\s*Output/i.test(header) || /^出力例/.test(header)) {
      const preM = rawContent.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
      const out = preM ? unescapeHtml(stripHtml(preM[1])).trim() : '';
      samples.push({ input: curIn, output: out });
      curIn = '';
    } else {
      const text = mathjaxToKatex(stripHtml(rawContent)).trim();
      if (text) parts.push(`## ${header}\n\n${text}`);
    }
  }

  return {
    title,
    statement: parts.join('\n\n'),
    examples: samples,
    source: { site: 'atcoder', url, pid },
  };
}

/** POJ：极简 HTML，<div class="ptt">title</div> + <div class="ptx">desc</div> + <pre>sample</pre> */
function parsePOJ(html: string, url: string, pid?: string): FetchedProblem {
  const titleM = html.match(/<div class="ptt"[^>]*>([\s\S]*?)<\/div>/);
  const title = titleM ? stripHtml(titleM[1]).trim() : `POJ ${pid}`;

  const ptxBlocks = [...html.matchAll(/<p class="pst">([^<]+)<\/p>\s*<div class="ptx"[^>]*>([\s\S]*?)<\/div>/g)];
  const preBlocks = [...html.matchAll(/<p class="pst">(Sample Input|Sample Output)<\/p>\s*<pre class="sio">([\s\S]*?)<\/pre>/g)];

  const parts: string[] = [];
  for (const [, header, body] of ptxBlocks) {
    parts.push(`## ${header.trim()}\n\n${stripHtml(body).trim()}`);
  }
  const examples: ParsedProblemExamples = [];
  let curIn = '';
  for (const [, header, body] of preBlocks) {
    if (header === 'Sample Input') curIn = unescapeHtml(body).trim();
    else if (header === 'Sample Output') {
      examples.push({ input: curIn, output: unescapeHtml(body).trim() });
      curIn = '';
    }
  }

  // POJ 限制：`Time Limit:</b> 1000MS</td>...<b>Memory Limit:</b> 10000K`
  const limM = html.match(/Time Limit:<\/b>\s*([^<]+)[\s\S]*?Memory Limit:<\/b>\s*([^<]+)/);
  const constraints = limM
    ? `时间限制：${limM[1].trim()} · 内存限制：${limM[2].trim()}`
    : undefined;

  if (parts.length === 0) throw new FetchProblemError('parse', 'POJ 题面解析为空');
  return { title, statement: parts.join('\n\n'), constraints, examples, source: { site: 'poj', url, pid } };
}

/** HDU：<h1 align=center>Title</h1>，每段 <div class=panel_content> */
function parseHDU(html: string, url: string, pid?: string): FetchedProblem {
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const title = titleM ? stripHtml(titleM[1]).trim() : `HDU ${pid}`;

  // HDU 章节：<div class=panel_title>Problem Description</div><div class=panel_content>...</div>
  const sections = [...html.matchAll(/<div class=panel_title[^>]*>\s*([^<]+)\s*<\/div>\s*<div class=panel_content[^>]*>([\s\S]*?)<\/div>/g)];
  const parts: string[] = [];
  const examples: ParsedProblemExamples = [];
  let curIn = '';
  for (const [, header, body] of sections) {
    const h = header.trim();
    const text = stripHtml(body).trim();
    if (/^Sample Input$/i.test(h)) curIn = text;
    else if (/^Sample Output$/i.test(h)) {
      examples.push({ input: curIn, output: text });
      curIn = '';
    } else {
      parts.push(`## ${h}\n\n${text}`);
    }
  }

  // HDU 限制：`Time Limit: 2000/1000 MS (Java/Others)&nbsp;&nbsp;&nbsp;&nbsp;Memory Limit: 65536/32768 K (Java/Others)`
  const limM = html.match(/Time Limit:\s*([\d/]+)\s*MS\s*\(([^)]*)\)[\s\S]*?Memory Limit:\s*([\d/]+)\s*K/);
  const constraints = limM
    ? `时间限制：${limM[1]} ms (${limM[2]}) · 内存限制：${limM[3]} KB`
    : undefined;

  if (parts.length === 0) throw new FetchProblemError('parse', 'HDU 题面解析为空');
  return { title, statement: parts.join('\n\n'), constraints, examples, source: { site: 'hdu', url, pid } };
}

// ─────────────────────────────────────────────────────────────
// 工具函数
// ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  // 处理结构标签前先保留换行/列表语义，避免多段粘连成一条
  return html
    // 列表项：转 markdown bullet
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    // 块级结束标签全部加换行
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|ul|ol|h[1-6]|tr|td|th|blockquote|table)>/gi, '\n')
    // 列表/块级开始标签也加换行（避免跟前面的内联文本紧贴）
    .replace(/<(p|div|section|ul|ol|h[1-6]|blockquote|table)[^>]*>/gi, '\n')
    // 删除剩余所有标签
    .replace(/<[^>]+>/g, '')
    // HTML 实体
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\u00A0/g, ' ')
    // 折叠多余空白
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function unescapeHtml(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** AtCoder MathJax \( ... \) 转成 KaTeX 兼容的 $ ... $ */
function mathjaxToKatex(s: string): string {
  return s
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, body) => `$${body}$`)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, body) => `$$${body}$$`);
}
