/**
 * Ollama 长上下文稳定性压测 — 测 sam:latest 在 1K/4K/8K/12K 输入下能否稳定输出 JSON。
 *
 * 测试维度：
 *   - prompt 长度（chars）
 *   - num_ctx（ollama 上下文窗口）
 *   - TTFT（首 token 延迟）
 *   - tok/s（server eval rate）
 *   - JSON 解析率
 *   - issues 数量是否合理
 *   - 失败模式：truncated / no-json / timeout / oom
 *
 * 跑法：
 *   node scripts/bench-ollama-longctx.mjs
 *   NUM_CTX=16384 node scripts/bench-ollama-longctx.mjs   # 调大窗口
 *   ROUNDS=2 node scripts/bench-ollama-longctx.mjs        # 每档跑 2 次
 */

import { writeFile, mkdir } from 'fs/promises';
import { spawn } from 'node:child_process';
import * as net from 'node:net';

const MODEL = process.env.MODEL || 'sam:latest';
const ENDPOINT = process.env.ENDPOINT || 'http://localhost:11434/api/chat';
const NUM_CTX = parseInt(process.env.NUM_CTX || '16384', 10);  // 16K 给 12K 输入留余量
const NUM_GPU = parseInt(process.env.NUM_GPU || '-1', 10);
const ROUNDS = parseInt(process.env.ROUNDS || '1', 10);
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || '120000', 10);
const OUT_DIR = 'bench-results';

// ============== Ollama 自动起 ==============

function probePort(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let done = false;
    const finish = (ok) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
  });
}

let managedOllama = null;
async function ensureOllama() {
  if (await probePort('127.0.0.1', 11434, 300)) {
    // 还要 verify /api/version 通
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1500);
      const r = await fetch('http://127.0.0.1:11434/api/version', { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) return true;
    } catch { /* 端口在但 hung，下面 spawn 兜底 */ }
  }
  console.log('[bench] 11434 未就绪，自动启动 ollama serve ...');
  managedOllama = spawn(process.platform === 'win32' ? 'ollama.exe' : 'ollama', ['serve'], {
    detached: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  managedOllama.on('error', (e) => console.warn(`[bench] spawn err: ${e.message}`));
  // poll 20s
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if (await probePort('127.0.0.1', 11434, 300)) {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 1500);
        const r = await fetch('http://127.0.0.1:11434/api/version', { signal: ctrl.signal });
        clearTimeout(t);
        if (r.ok) { console.log('[bench] ✓ ollama 就绪'); return true; }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.warn('[bench] ⚠ ollama 20s 内未就绪');
  return false;
}

process.on('exit', () => {
  if (managedOllama && !managedOllama.killed) {
    try { managedOllama.kill(); } catch {}
  }
});

const SYSTEM = `你是一位资深算法竞赛教练。
风格：直接、技术、可执行。
输出严格 JSON，不要 markdown 标记。`;

// ============== 长 prompt 构造 ==============

/**
 * 构造一段"看似真实"的 C++ 解题代码（重复 + 注释填充长度）。
 * 用于模拟用户粘贴超长代码 / 多文件场景。
 */
function makeLongCode(targetChars) {
  const block = `
// ----- 模块: 数据结构 ----------------------------------------------
struct Edge {
  int u, v;        // 起点 / 终点
  long long w;     // 边权
  Edge(int u_=0, int v_=0, long long w_=0): u(u_), v(v_), w(w_) {}
  bool operator<(const Edge& o) const { return w < o.w; }
};

class DSU {
public:
  DSU(int n): par(n), sz(n, 1) { iota(par.begin(), par.end(), 0); }
  int find(int x) { return par[x]==x ? x : par[x]=find(par[x]); }
  bool unite(int a, int b) {
    a = find(a); b = find(b);
    if (a == b) return false;
    if (sz[a] < sz[b]) swap(a, b);
    par[b] = a; sz[a] += sz[b];
    return true;
  }
private:
  vector<int> par, sz;
};

// ----- 工具：BFS / DFS / 二分 -------------------------------------
template<typename T>
int lower_bound_idx(const vector<T>& v, T target) {
  int lo = 0, hi = (int)v.size();
  while (lo < hi) {
    int mid = (lo + hi) >> 1;
    if (v[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

`;
  let out = '';
  while (out.length < targetChars) out += block;
  return out.slice(0, targetChars);
}

/**
 * 构造长 user prompt：题目 + 主代码 + N 个 sibling 文件
 * 总字符数 ≈ targetChars
 */
function buildPrompt(targetChars) {
  const STATEMENT = `给定无向带权图 G(V, E)，|V|≤2e5，|E|≤5e5，边权 0..1e9。
求从节点 1 到所有其它节点的最短路径长度。如不可达输出 -1。
要求：使用 Dijkstra + 优先队列，时间复杂度 O((V+E) log V)。`;

  const HEADER = `当前题目：图论·单源最短路径（Dijkstra）
${STATEMENT}

学生当前 cpp 代码：
\`\`\`cpp
`;

  const FOOTER = `
\`\`\`

请输出 JSON：
{
  "summary": "代码整体在做什么 + 主要问题（一句话）",
  "issues": [
    {
      "line": 行号,
      "severity": "error" | "warning" | "info" | "hint",
      "message": "问题描述",
      "suggestion": "具体怎么改"
    }
  ],
  "complexity": "Big-O 分析",
  "verdict": "ac-likely" | "wa-risk" | "tle-risk" | "rte-risk"
}

直接输出 JSON。`;

  // 留 200 字符给 footer
  const codeBudget = Math.max(500, targetChars - HEADER.length - FOOTER.length);
  return HEADER + makeLongCode(codeBudget) + FOOTER;
}

// ============== 调用 ollama ==============

async function callOllama({ prompt, numCtx, signal }) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: prompt + '\n/no_think' },
    ],
    stream: true,
    think: false,
    options: {
      num_gpu: NUM_GPU,
      num_ctx: numCtx,
      temperature: 0.2,
    },
  };

  const t0 = performance.now();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  let firstTokenAt = 0;
  let chars = 0;
  let acc = '';
  let serverEvalCount = 0;
  let serverEvalDuration = 0;
  let serverPromptEvalCount = 0;
  let serverLoadDuration = 0;
  let totalDuration = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let frame;
      try { frame = JSON.parse(line); } catch { continue; }
      if (frame.message?.content) {
        if (!firstTokenAt) firstTokenAt = performance.now();
        acc += frame.message.content;
        chars += frame.message.content.length;
      }
      if (frame.done) {
        serverEvalCount = frame.eval_count ?? 0;
        serverEvalDuration = frame.eval_duration ?? 0;
        serverPromptEvalCount = frame.prompt_eval_count ?? 0;
        serverLoadDuration = frame.load_duration ?? 0;
        totalDuration = frame.total_duration ?? 0;
      }
    }
  }
  const t1 = performance.now();

  // 解析 JSON
  let parsed = null;
  let parseErr = null;
  try {
    // 尝试直接 parse
    parsed = JSON.parse(acc.trim());
  } catch (e) {
    // 尝试提取首个 {...} 块
    const m = acc.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch (e2) { parseErr = e2.message; }
    } else {
      parseErr = e.message;
    }
  }

  return {
    rawChars: chars,
    raw: acc,
    parsed,
    parseErr,
    ttftMs: firstTokenAt ? Math.round(firstTokenAt - t0) : -1,
    totalMs: Math.round(t1 - t0),
    serverEvalCount,
    serverEvalDurationMs: Math.round(serverEvalDuration / 1e6),
    serverPromptEvalCount,
    serverLoadMs: Math.round(serverLoadDuration / 1e6),
    serverTotalMs: Math.round(totalDuration / 1e6),
    serverTokPerSec: serverEvalDuration > 0
      ? Math.round((serverEvalCount / (serverEvalDuration / 1e9)) * 10) / 10
      : 0,
  };
}

// ============== 单次执行封装 ==============

async function runOne({ label, prompt, numCtx }) {
  process.stdout.write(`  ${label}: `);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const result = await callOllama({ prompt, numCtx, signal: ctrl.signal });
    clearTimeout(timer);
    const issues = result.parsed?.issues?.length ?? null;
    const status = result.parsed
      ? `✓ JSON ok (issues=${issues})`
      : `⚠ JSON FAIL [${result.parseErr?.slice(0, 40)}]`;
    console.log(
      `TTFT=${result.ttftMs}ms total=${result.totalMs}ms ` +
      `srv_tok/s=${result.serverTokPerSec} ` +
      `prompt_eval=${result.serverPromptEvalCount}t load=${result.serverLoadMs}ms | ${status}`,
    );
    return {
      ttftMs: result.ttftMs,
      totalMs: result.totalMs,
      serverTokPerSec: result.serverTokPerSec,
      serverEvalCount: result.serverEvalCount,
      serverEvalDurationMs: result.serverEvalDurationMs,
      serverPromptEvalCount: result.serverPromptEvalCount,
      serverLoadMs: result.serverLoadMs,
      jsonOk: !!result.parsed,
      issues,
      verdict: result.parsed?.verdict ?? null,
    };
  } catch (e) {
    clearTimeout(timer);
    console.log(`✗ ${e.message}`);
    return { error: e.message, jsonOk: false };
  }
}

// ============== 跑测试 ==============

/**
 * MODE=stability（默认）：
 *   固定 num_ctx=8192，测 1K/4K/7K chars 输入（接近但不超窗口）
 *   → 验证生产用途下 tok/s、TTFT、JSON 稳定性
 *
 * MODE=ceiling：
 *   依次设 num_ctx=4K/8K/16K/24K/32K，每档用 ≈ 80% 窗口大小的输入
 *   → 找 sam:latest 能稳定运行的最大上下文上限（显存 / tok/s / JSON 是否劣化）
 */
const MODE = process.env.MODE || 'stability';

const STABILITY_SIZES = [
  { id: '1k',  chars: 1_000 },
  { id: '4k',  chars: 4_000 },
  { id: '7k',  chars: 7_000 },
];

// ceiling 模式：num_ctx 逐档升高，输入 ≈ 80% × num_ctx chars
const CEILING_CTXS = [4096, 8192, 16384, 24576, 32768];

async function runStability() {
  console.log(`\n[Mode: stability] num_ctx=${NUM_CTX}, 测 1K/4K/7K 输入稳定性\n`);
  const summary = [];
  for (const sz of STABILITY_SIZES) {
    const prompt = buildPrompt(sz.chars);
    console.log(`── ${sz.id} | prompt=${prompt.length} chars ──`);
    for (let r = 1; r <= ROUNDS; r++) {
      const row = await runOne({ label: `${sz.id} r${r}`, prompt, numCtx: NUM_CTX });
      summary.push({ size: sz.id, round: r, promptChars: prompt.length, ...row });
    }
  }
  return summary;
}

async function runCeiling() {
  // 固定一个"代表性"输入（≈3000 tokens ≈ 10500 chars）
  // 只改 num_ctx，看 KV cache 装不下 GPU 时 tok/s 什么时候跌
  // tok/s 跌之前最后一档 = 可安全使用的最大窗口
  const FIXED_INPUT_CHARS = 10500; // ≈3000 tokens
  const prompt = buildPrompt(FIXED_INPUT_CHARS);
  console.log(`\n[Mode: ceiling] 固定输入≈${prompt.length} chars，逐步拉大 num_ctx，找 GPU KV cache 上限\n`);
  console.log(`逻辑：num_ctx 越大 → 占比越低 → 幻觉越少；但 KV cache 超过 GPU 显存 → tok/s 暴跌`);
  console.log(`目标：找 tok/s 开始掉之前的最大 num_ctx，直接用那个值\n`);

  const summary = [];
  let lastTps = 0;
  for (const ctx of CEILING_CTXS) {
    console.log(`── num_ctx=${ctx} ──`);
    for (let r = 1; r <= ROUNDS; r++) {
      const row = await runOne({ label: `ctx${ctx} r${r}`, prompt, numCtx: ctx });
      summary.push({ numCtx: ctx, round: r, promptChars: prompt.length, ...row });
      if (row.error) {
        console.log(`  ✗ 失败，停止探测`);
        return summary;
      }
      // tok/s 跌超过 30%（相对基线）→ GPU offload 已开始
      if (lastTps > 0 && row.serverTokPerSec < lastTps * 0.7) {
        console.log(`  ⚠ tok/s=${row.serverTokPerSec} vs 上档=${lastTps}，降幅>${Math.round((1-row.serverTokPerSec/lastTps)*100)}%，KV cache 已超 GPU → 停止`);
        return summary;
      }
      lastTps = row.serverTokPerSec || lastTps;
    }
  }
  return summary;
}

// SIZES 仅供下面兼容保留，实际不用
const SIZES = STABILITY_SIZES;

console.log(`\n=== Ollama 长上下文压测 [${MODE}] ===`);
console.log(`Model: ${MODEL} | num_ctx: ${NUM_CTX} | num_gpu: ${NUM_GPU} | rounds: ${ROUNDS}`);
console.log(`Endpoint: ${ENDPOINT}\n`);

if (!(await ensureOllama())) {
  console.error('无法启动 ollama，退出');
  process.exit(1);
}

const summary = MODE === 'ceiling' ? await runCeiling() : await runStability();

// ============== 汇总报告 ==============

await mkdir(OUT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const jsonPath = `${OUT_DIR}/longctx-${ts}.json`;
await writeFile(jsonPath, JSON.stringify({ model: MODEL, numCtx: NUM_CTX, numGpu: NUM_GPU, summary }, null, 2));

let md = `# Ollama 长上下文稳定性报告\n\n`;
md += `- Model: \`${MODEL}\`\n`;
md += `- num_ctx: ${NUM_CTX}\n`;
md += `- num_gpu: ${NUM_GPU}\n`;
md += `- 跑次: ${ROUNDS}/档\n\n`;
if (MODE === 'ceiling') {
  md += `| num_ctx | prompt chars | TTFT(ms) | total(ms) | tok/s | prompt_eval | load(ms) | JSON |\n`;
  md += `|---|---|---|---|---|---|---|---|\n`;
  for (const s of summary) {
    if (s.error) {
      md += `| ${s.numCtx} | ${s.promptChars} | — | — | — | — | — | ✗ |\n`;
    } else {
      md += `| ${s.numCtx} | ${s.promptChars} | ${s.ttftMs} | ${s.totalMs} | ${s.serverTokPerSec} | ${s.serverPromptEvalCount} | ${s.serverLoadMs} | ${s.jsonOk ? '✓' : '✗'} |\n`;
    }
  }
} else {
  md += `| 档 | prompt chars | TTFT(ms) | total(ms) | tok/s | eval | prompt_eval | load(ms) | JSON | issues |\n`;
  md += `|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const s of summary) {
    if (s.error) {
      md += `| ${s.size} | ${s.promptChars} | — | — | — | — | — | — | ✗ | err: \`${s.error.slice(0, 40)}\` |\n`;
    } else {
      md += `| ${s.size} | ${s.promptChars} | ${s.ttftMs} | ${s.totalMs} | ${s.serverTokPerSec} | ${s.serverEvalCount} | ${s.serverPromptEvalCount} | ${s.serverLoadMs} | ${s.jsonOk ? '✓' : '✗'} | ${s.issues ?? '—'} |\n`;
    }
  }
}

// 稳定性结论
const ok = summary.filter((s) => s.jsonOk).length;
const fail = summary.length - ok;
md += `\n## 稳定性\n\n- 成功: ${ok}/${summary.length}\n- 失败: ${fail}\n`;
const tps = summary.filter((s) => s.serverTokPerSec).map((s) => s.serverTokPerSec);
if (tps.length) md += `- tok/s 范围: ${Math.min(...tps)} – ${Math.max(...tps)}\n`;

const mdPath = `${OUT_DIR}/longctx-${ts}.md`;
await writeFile(mdPath, md);

console.log(`\n=== 完成 ===`);
console.log(`成功 ${ok}/${summary.length}`);
console.log(`JSON: ${jsonPath}`);
console.log(`MD:   ${mdPath}`);

// 脚本自己起的 ollama 用完就关，不留残留进程
if (managedOllama && !managedOllama.killed) {
  console.log('[bench] 关闭 managed ollama serve');
  try { managedOllama.kill(); } catch {}
  managedOllama = null;
}
process.exit(0);
