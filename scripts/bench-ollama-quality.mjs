/**
 * sam:latest 质量极限测试 —— 不同难度下的 bug 识别准确率
 *
 * 设计：
 *   每个 case 有"已知 bug 列表"（ground truth），
 *   跑 sam，看命中率。
 *   命中率 < ROUTE_THRESHOLD → 建议路由到云端。
 *
 * 难度档：
 *   D1 简单 — 语法/IO 类问题（cin 未解绑、cout<<endl vs '\n'）
 *   D2 中等 — 复杂度/算法类（O(n²) 应 O(n log n)、map 滥用）
 *   D3 困难 — 边界/状态机类（DP 转移错误、图论边界、整数溢出）
 *   D4 极难 — 数论/计算几何/位运算 trick（需要深度领域知识）
 *
 * 跑法：node scripts/bench-ollama-quality.mjs
 */

import { writeFile, mkdir } from 'fs/promises';
import { spawn } from 'node:child_process';
import * as net from 'node:net';

const MODEL    = process.env.MODEL    || 'sam:latest';
const ENDPOINT = process.env.ENDPOINT || 'http://localhost:11434/api/chat';
const NUM_CTX  = parseInt(process.env.NUM_CTX  || '24576', 10);
const TIMEOUT  = parseInt(process.env.TIMEOUT  || '90000', 10);
const OUT_DIR  = 'bench-results';

// 命中率低于此阈值 → 建议路由到云端
const ROUTE_THRESHOLD = 0.6;

// ===== Ollama auto-start =====
function probePort(host, port, ms = 400) {
  return new Promise((resolve) => {
    const s = net.createConnection({ host, port });
    let done = false;
    const fin = (ok) => { if (!done) { done = true; s.destroy(); resolve(ok); } };
    s.setTimeout(ms); s.once('connect', () => fin(true));
    s.once('timeout', () => fin(false)); s.once('error', () => fin(false));
  });
}
let managed = null;
async function ensureOllama() {
  if (await probePort('127.0.0.1', 11434, 300)) {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 1500);
      const r = await fetch('http://127.0.0.1:11434/api/version', { signal: c.signal });
      clearTimeout(t); if (r.ok) return true;
    } catch {}
  }
  console.log('[quality] 自动启动 ollama serve ...');
  managed = spawn(process.platform === 'win32' ? 'ollama.exe' : 'ollama', ['serve'],
    { detached: false, stdio: 'ignore', windowsHide: true });
  managed.on('error', (e) => console.warn(`[quality] spawn err: ${e.message}`));
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if (await probePort('127.0.0.1', 11434, 300)) {
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 1500);
        const r = await fetch('http://127.0.0.1:11434/api/version', { signal: c.signal });
        clearTimeout(t); if (r.ok) { console.log('[quality] ✓ ollama 就绪'); return true; }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
process.on('exit', () => { if (managed && !managed.killed) { try { managed.kill(); } catch {} } });

// ===== Test cases =====
// ground_truth: 应该命中的关键词（从 sam 的 issues 里 message 找）
// 只要 issues 里有任意一条 message 包含任一关键词 → 该条命中
const CASES = [
  // ─────── D1 简单 ───────
  {
    id: 'd1-cin-untied',
    level: 'D1',
    title: 'A+B × N',
    statement: '读入 N (≤1e6) 对整数，输出每对之和。',
    language: 'cpp',
    code: `#include<iostream>
using namespace std;
int main(){
    int n; cin>>n;
    for(int i=0;i<n;i++){
        int a,b; cin>>a>>b;
        cout<<a+b<<endl;
    }
}`,
    ground_truth: [
      { desc: 'cin 未解绑', keywords: ['sync_with_stdio', 'untie', 'ios', 'cin.tie', 'TLE', 'slow'] },
      { desc: 'endl 刷缓冲', keywords: ['endl', '\\n', 'flush', 'slower'] },
    ],
  },
  {
    id: 'd1-uninit',
    level: 'D1',
    title: '数组未初始化',
    statement: '给定 N 个数，求其中正数的个数。',
    language: 'cpp',
    code: `#include<iostream>
using namespace std;
int cnt;
int main(){
    int n; cin>>n;
    for(int i=0;i<n;i++){
        int x; cin>>x;
        if(x>0) cnt++;
    }
    cout<<cnt;
}`,
    ground_truth: [
      { desc: '全局 cnt 默认 0（实际无 bug，考验误报率）', keywords: [] }, // 空 keywords = 期望无 issue
    ],
    expectClean: true, // 期望 sam 不报错（或只报 minor hint）
  },

  // ─────── D2 中等 ───────
  {
    id: 'd2-on2',
    level: 'D2',
    title: 'Two Sum O(n²)',
    statement: '数组 a，目标 t，找 i<j 使 a[i]+a[j]=t，N≤1e5。',
    language: 'cpp',
    code: `#include<iostream>
#include<vector>
using namespace std;
int main(){
    int n,t; cin>>n>>t;
    vector<int> a(n);
    for(auto& x:a) cin>>x;
    for(int i=0;i<n;i++)
        for(int j=i+1;j<n;j++)
            if(a[i]+a[j]==t){
                cout<<i+1<<" "<<j+1; return 0;
            }
    cout<<-1;
}`,
    ground_truth: [
      { desc: 'O(n²) TLE', keywords: ['O(n', 'TLE', 'tle', 'hash', 'unordered_map', 'complexity', '复杂度'] },
    ],
  },
  {
    id: 'd2-overflow',
    level: 'D2',
    title: '前缀和溢出',
    statement: '给定 N (≤1e5) 个 int，求前缀和数组。',
    language: 'cpp',
    code: `#include<iostream>
using namespace std;
int a[100005], pre[100005];
int main(){
    int n; cin>>n;
    for(int i=1;i<=n;i++) cin>>a[i];
    for(int i=1;i<=n;i++) pre[i]=pre[i-1]+a[i];
    for(int i=1;i<=n;i++) cout<<pre[i]<<" ";
}`,
    ground_truth: [
      { desc: 'int 前缀和溢出（a[i] 可到 1e9 × 1e5 = 1e14 > INT_MAX）', keywords: ['overflow', 'long long', 'int', '溢出', '超出'] },
    ],
  },

  // ─────── D3 困难 ───────
  {
    id: 'd3-dp-wrong',
    level: 'D3',
    title: '01背包转移方向错误',
    statement: 'N 件物品，重量 w[i]，价值 v[i]，背包容量 W，求最大价值。',
    language: 'cpp',
    code: `#include<iostream>
#include<vector>
using namespace std;
int main(){
    int n,W; cin>>n>>W;
    vector<int> w(n),v(n);
    for(int i=0;i<n;i++) cin>>w[i]>>v[i];
    vector<int> dp(W+1,0);
    for(int i=0;i<n;i++)
        for(int j=w[i];j<=W;j++)   // 正向遍历 → 完全背包，不是 01 背包
            dp[j]=max(dp[j],dp[j-w[i]]+v[i]);
    cout<<dp[W];
}`,
    ground_truth: [
      { desc: '01背包应逆序遍历，正序变成完全背包', keywords: ['逆序', 'reverse', '完全背包', '01', 'unbounded', 'knapsack', 'j--', 'W down'] },
    ],
  },
  {
    id: 'd3-dijkstra-neg',
    level: 'D3',
    title: 'Dijkstra 负权边',
    statement: '有向图，边权可能为负，求最短路。N≤500，E≤1e4。',
    language: 'cpp',
    code: `#include<bits/stdc++.h>
using namespace std;
const int INF=1e9;
int dist[505];
bool vis[505];
vector<pair<int,int>> g[505];
int main(){
    int n,m; cin>>n>>m;
    fill(dist,dist+n+1,INF); dist[1]=0;
    while(m--){ int u,v,w; cin>>u>>v>>w; g[u].push_back({v,w}); }
    priority_queue<pair<int,int>,vector<pair<int,int>>,greater<>> pq;
    pq.push({0,1});
    while(!pq.empty()){
        auto [d,u]=pq.top(); pq.pop();
        if(vis[u]) continue; vis[u]=true;
        for(auto [v,w]:g[u])
            if(dist[u]+w<dist[v]){ dist[v]=dist[u]+w; pq.push({dist[v],v}); }
    }
    for(int i=1;i<=n;i++) cout<<(dist[i]==INF?-1:dist[i])<<" ";
}`,
    ground_truth: [
      { desc: '有负权边时 Dijkstra 不正确，需用 Bellman-Ford / SPFA', keywords: ['负权', 'negative', 'Bellman', 'SPFA', 'Dijkstra.*negative', 'wrong'] },
    ],
  },

  // ─────── D4 极难 ───────
  {
    id: 'd4-modular',
    level: 'D4',
    title: '快速幂取模（乘法溢出）',
    statement: '计算 a^b mod p，a,b,p ≤ 1e18。',
    language: 'cpp',
    code: `#include<iostream>
using namespace std;
typedef long long ll;
ll power(ll a,ll b,ll p){
    ll res=1; a%=p;
    while(b>0){
        if(b&1) res=res*a%p;   // res*a 在 p≈1e18 时溢出 ll
        a=a*a%p;               // a*a 同样溢出
        b>>=1;
    }
    return res;
}
int main(){
    ll a,b,p; cin>>a>>b>>p;
    cout<<power(a,b,p);
}`,
    ground_truth: [
      { desc: 'p≈1e18 时 res*a 溢出 long long，需用 __int128 或 mulmod', keywords: ['__int128', 'overflow', 'mulmod', 'unsigned', '128', '溢出', 'long long.*overflow'] },
    ],
  },
  {
    id: 'd4-geometry',
    level: 'D4',
    title: '叉积判点在线段上（浮点精度）',
    statement: '判断点 P 是否在线段 AB 上。',
    language: 'cpp',
    code: `#include<iostream>
#include<cmath>
using namespace std;
struct P{ double x,y; };
double cross(P o,P a,P b){ return (a.x-o.x)*(b.y-o.y)-(a.y-o.y)*(b.x-o.x); }
bool onSeg(P p,P a,P b){
    return cross(p,a,b)==0 &&    // 浮点 == 0 不可靠
           min(a.x,b.x)<=p.x && p.x<=max(a.x,b.x) &&
           min(a.y,b.y)<=p.y && p.y<=max(a.y,b.y);
}
int main(){
    P p,a,b; cin>>p.x>>p.y>>a.x>>a.y>>b.x>>b.y;
    cout<<(onSeg(p,a,b)?"YES":"NO");
}`,
    ground_truth: [
      { desc: '浮点 ==0 比较不可靠，应用 fabs(cross)<eps', keywords: ['eps', 'epsilon', 'fabs', 'precision', 'floating', '精度', '浮点'] },
    ],
  },
];

// ===== Prompt builder =====
const SYSTEM = `你是算法竞赛代码审查员。
输出严格 JSON，不含 markdown。`;

function buildPrompt({ title, statement, language, code }) {
  return `题目：${title}
${statement}

代码（${language}）：
\`\`\`${language}
${code}
\`\`\`

输出 JSON：
{
  "verdict": "ac-likely" | "wa-risk" | "tle-risk" | "rte-risk",
  "issues": [{ "line": number, "severity": "error"|"warning"|"info"|"hint", "message": "..." }],
  "summary": "一句话"
}
直接输出 JSON，不加任何说明。`;
}

// ===== Single call =====
async function callOllama(userPrompt) {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userPrompt + ' /no_think' },
    ],
    stream: true, think: false,
    options: { num_gpu: -1, num_ctx: NUM_CTX, temperature: 0.1 },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const t0 = performance.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!res.ok) { clearTimeout(timer); throw new Error(`HTTP ${res.status}`); }
    let acc = '', firstAt = 0, evalCount = 0, evalDur = 0;
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let f; try { f = JSON.parse(line); } catch { continue; }
        if (f.message?.content) { if (!firstAt) firstAt = performance.now(); acc += f.message.content; }
        if (f.done) { evalCount = f.eval_count ?? 0; evalDur = f.eval_duration ?? 0; }
      }
    }
    clearTimeout(timer);
    let parsed = null;
    try { parsed = JSON.parse(acc.trim()); } catch {
      const m = acc.match(/\{[\s\S]*\}/); if (m) try { parsed = JSON.parse(m[0]); } catch {}
    }
    return {
      raw: acc, parsed,
      ttftMs: firstAt ? Math.round(firstAt - t0) : -1,
      totalMs: Math.round(performance.now() - t0),
      tokPerSec: evalDur > 0 ? Math.round(evalCount / (evalDur / 1e9) * 10) / 10 : 0,
    };
  } catch (e) { clearTimeout(timer); throw e; }
}

// ===== Scoring =====
function score(c, parsed) {
  if (c.expectClean) {
    // 期望无重大 issue：error/warning 级别的 issue 数量 = 0 算 pass
    const severe = (parsed?.issues ?? []).filter(i => i.severity === 'error' || i.severity === 'warning').length;
    return { hits: severe === 0 ? 1 : 0, total: 1, detail: severe === 0 ? ['no false positive ✓'] : [`false positive: ${severe} warning/error`] };
  }
  let hits = 0;
  const detail = [];
  for (const gt of c.ground_truth) {
    if (gt.keywords.length === 0) continue;
    const allText = JSON.stringify(parsed?.issues ?? []).toLowerCase();
    const hit = gt.keywords.some(k => allText.includes(k.toLowerCase()));
    if (hit) { hits++; detail.push(`✓ ${gt.desc}`); } else { detail.push(`✗ ${gt.desc}`); }
  }
  const total = c.ground_truth.filter(g => g.keywords.length > 0).length || 1;
  return { hits, total, detail };
}

// ===== Main =====
if (!(await ensureOllama())) { console.error('ollama 未就绪'); process.exit(1); }

console.log(`\n=== sam 质量极限测试 ===`);
console.log(`Model=${MODEL} | num_ctx=${NUM_CTX}\n`);

const results = [];
for (const c of CASES) {
  process.stdout.write(`[${c.level}] ${c.id}: `);
  let res;
  try { res = await callOllama(buildPrompt(c)); }
  catch (e) { console.log(`✗ ${e.message}`); results.push({ ...c, error: e.message }); continue; }

  const sc = score(c, res.parsed);
  const pct = Math.round(sc.hits / sc.total * 100);
  const flag = pct >= 60 ? '✓' : '⚠';
  console.log(`${flag} ${pct}% (${sc.hits}/${sc.total}) | TTFT=${res.ttftMs}ms tok/s=${res.tokPerSec} | verdict=${res.parsed?.verdict ?? '?'}`);
  for (const d of sc.detail) console.log(`   ${d}`);
  results.push({ id: c.id, level: c.level, title: c.title, pct, hits: sc.hits, total: sc.total, detail: sc.detail, ttftMs: res.ttftMs, tokPerSec: res.tokPerSec, verdict: res.parsed?.verdict, jsonOk: !!res.parsed });
}

// ===== Report =====
await mkdir(OUT_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

// 按难度档汇总命中率
const byLevel = {};
for (const r of results) {
  if (!byLevel[r.level]) byLevel[r.level] = { hits: 0, total: 0 };
  byLevel[r.level].hits += r.hits ?? 0;
  byLevel[r.level].total += r.total ?? 1;
}

let md = `# sam:latest 质量极限报告\n\n`;
md += `- Model: \`${MODEL}\`\n- num_ctx: ${NUM_CTX}\n\n`;
md += `## 各档命中率\n\n`;
md += `| 难度 | 命中率 | 路由建议 |\n|---|---|---|\n`;
for (const [lvl, s] of Object.entries(byLevel)) {
  const pct = Math.round(s.hits / s.total * 100);
  const route = pct < ROUTE_THRESHOLD * 100 ? '⚠ 建议路由到云端' : '✓ 本地可用';
  md += `| ${lvl} | ${pct}% (${s.hits}/${s.total}) | ${route} |\n`;
}

md += `\n## 明细\n\n| case | 命中率 | TTFT | tok/s | verdict |\n|---|---|---|---|---|\n`;
for (const r of results) {
  if (r.error) { md += `| ${r.id} | ERROR | — | — | — |\n`; continue; }
  md += `| ${r.id} | ${r.pct}% | ${r.ttftMs}ms | ${r.tokPerSec} | ${r.verdict ?? '?'} |\n`;
}

md += `\n## 自动路由建议\n\n`;
const needRoute = Object.entries(byLevel).filter(([,s]) => s.hits/s.total < ROUTE_THRESHOLD).map(([l]) => l);
if (needRoute.length === 0) {
  md += `sam 在所有难度档命中率 ≥ 60%，**无需路由**，直接用本地即可。\n`;
} else {
  md += `以下难度档建议路由到云端（命中率 < 60%）：**${needRoute.join(', ')}**\n\n`;
  md += `实现方式：在 \`enqueueAnalyze\` 里判断 problem.difficulty，${needRoute.join('/')} 难度题跳过 fastLane，直接用主 cfg（云端）。\n`;
}

const mdPath = `${OUT_DIR}/quality-${ts}.md`;
const jsonPath = `${OUT_DIR}/quality-${ts}.json`;
await writeFile(mdPath, md);
await writeFile(jsonPath, JSON.stringify({ model: MODEL, numCtx: NUM_CTX, results, byLevel }, null, 2));

console.log(`\n=== 难度汇总 ===`);
for (const [lvl, s] of Object.entries(byLevel)) {
  const pct = Math.round(s.hits / s.total * 100);
  console.log(`  ${lvl}: ${pct}% ${pct < 60 ? '⚠ 建议路由' : '✓'}`);
}
console.log(`\nMD: ${mdPath}`);

if (managed && !managed.killed) { try { managed.kill(); } catch {} }
process.exit(0);
