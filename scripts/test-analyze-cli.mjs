/**
 * CLI 模拟真实 analyzeCode 请求
 * 构造与网站完全相同的 system+user prompt，直接打 Ollama，打印流式输出
 *
 * 用法：node scripts/test-analyze-cli.mjs
 */

import { spawn } from 'node:child_process';
import * as net from 'node:net';

const MODEL    = process.env.MODEL    || 'sam:latest';
const ENDPOINT = process.env.ENDPOINT || 'http://localhost:11434/api/chat';
const NUM_CTX  = 20480;

// ── 与 prompts.ts 完全一致的 SYSTEM ──
const SYSTEM = `你是一位资深的算法竞赛教练和编程导师，专注于辅导大学生学习 C++ 和 Python。

你的风格：
- 直接、犀利、不说废话
- 优先指出最关键的问题（按严重程度排序）
- 给出可执行的具体修改建议，不空谈
- 复杂度分析必须给出 Big-O 表达式
- 输出严格使用 JSON 格式，不包含 \`\`\`json 标记或任何额外文字`;

// ── 测试 case：01背包方向错误（D3 难度） ──
const PROBLEM_TITLE   = '01背包';
const PROBLEM_STMT    = 'N 件物品，重量 w[i]，价值 v[i]，背包容量 W，每件只能选一次，求最大总价值。N,W≤1000，v[i],w[i]≤1000。';
const PROBLEM_CONSTR  = '1 ≤ N ≤ 1000，1 ≤ W ≤ 1000';
const LANGUAGE        = 'cpp';
const CODE = `\
#include<iostream>
#include<vector>
using namespace std;
int main(){
    int n,W; cin>>n>>W;
    vector<int> w(n),v(n);
    for(int i=0;i<n;i++) cin>>w[i]>>v[i];
    vector<int> dp(W+1,0);
    for(int i=0;i<n;i++)
        for(int j=w[i];j<=W;j++)
            dp[j]=max(dp[j],dp[j-w[i]]+v[i]);
    cout<<dp[W];
}`;

const USER_PROMPT = `【当前题目】
标题：${PROBLEM_TITLE}
题面：${PROBLEM_STMT}
约束：${PROBLEM_CONSTR}
【学生当前正在分析的 ${LANGUAGE} 代码】
\`\`\`${LANGUAGE}
${CODE}
\`\`\`

输出 JSON：
{
  "issues": [
    {
      "line": 行号(1-indexed, 整数),
      "severity": "error" | "warning" | "info" | "hint",
      "category": "bug" | "optimization" | "style" | "algorithm",
      "message": "问题描述（一句话）",
      "suggestion": "具体怎么改（一两句话）"
    }
  ],
  "complexitySummary": "时间 O(...)，空间 O(...)，简短说明",
  "overallComment": "整体评价（2-3 句话：能否 AC，关键瓶颈在哪）"
}

要求：
1. 按严重程度排序，最关键的问题排第一
2. 不要为没问题的代码硬找问题，issues 可以为空数组
3. 重点关注：边界条件、TLE/MLE 风险、算法选择、语言特性陷阱
4. 直接输出 JSON /no_think`;

// ── Ollama auto-start ──
function probePort(host, port, ms = 400) {
  return new Promise((r) => {
    const s = net.createConnection({ host, port });
    let done = false;
    const fin = (ok) => { if (!done) { done = true; s.destroy(); r(ok); } };
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
  console.log('[cli] 自动启动 ollama serve ...');
  managed = spawn(process.platform === 'win32' ? 'ollama.exe' : 'ollama', ['serve'],
    { detached: false, stdio: 'ignore', windowsHide: true });
  managed.on('error', (e) => console.error('[cli] spawn err:', e.message));
  const start = Date.now();
  while (Date.now() - start < 20_000) {
    if (await probePort('127.0.0.1', 11434, 300)) {
      try {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), 1500);
        const r = await fetch('http://127.0.0.1:11434/api/version', { signal: c.signal });
        clearTimeout(t); if (r.ok) { console.log('[cli] ✓ ollama 就绪\n'); return true; }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
process.on('exit', () => { if (managed && !managed.killed) { try { managed.kill(); } catch {} } });

// ── Main ──
if (!(await ensureOllama())) { console.error('ollama 未就绪'); process.exit(1); }

console.log('='.repeat(60));
console.log(`题目：${PROBLEM_TITLE}`);
console.log(`语言：${LANGUAGE} | num_ctx=${NUM_CTX}`);
console.log('='.repeat(60));
console.log('\n[streaming output]\n');

const t0 = performance.now();
let firstChunk = true, tokenCount = 0, acc = '';
let evalCount = 0, evalDur = 0, promptEvalCount = 0;

const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user',   content: USER_PROMPT },
    ],
    stream: true, think: false,
    options: { num_gpu: -1, num_ctx: NUM_CTX, temperature: 0.1 },
  }),
});

if (!res.ok) { console.error('HTTP', res.status, await res.text()); process.exit(1); }

const reader = res.body.getReader();
const dec    = new TextDecoder();
let buf = '';

while (true) {
  const { done, value } = await reader.read(); if (done) break;
  buf += dec.decode(value, { stream: true });
  const lines = buf.split('\n'); buf = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let f; try { f = JSON.parse(line); } catch { continue; }
    if (f.message?.content) {
      if (firstChunk) {
        console.log(`TTFT: ${Math.round(performance.now() - t0)}ms\n`);
        firstChunk = false;
      }
      process.stdout.write(f.message.content);
      acc += f.message.content;
      tokenCount++;
    }
    if (f.done) {
      evalCount      = f.eval_count       ?? 0;
      evalDur        = f.eval_duration    ?? 0;
      promptEvalCount = f.prompt_eval_count ?? 0;
    }
  }
}

const totalMs = Math.round(performance.now() - t0);
const tokPerSec = evalDur > 0 ? Math.round(evalCount / (evalDur / 1e9) * 10) / 10 : 0;

console.log('\n\n' + '='.repeat(60));
console.log(`总耗时: ${totalMs}ms | prompt_eval: ${promptEvalCount}t | eval: ${evalCount}t | tok/s: ${tokPerSec}`);

// JSON 解析验证
let parsed = null;
try { parsed = JSON.parse(acc.trim()); }
catch { const m = acc.match(/\{[\s\S]*\}/); if (m) try { parsed = JSON.parse(m[0]); } catch {} }

if (parsed) {
  console.log(`\n✓ JSON 解析成功`);
  console.log(`issues 数量: ${parsed.issues?.length ?? 0}`);
  console.log(`complexitySummary: ${parsed.complexitySummary ?? '-'}`);
  console.log(`overallComment: ${parsed.overallComment ?? '-'}`);
  if (parsed.issues?.length) {
    console.log('\n── issues ──');
    for (const iss of parsed.issues) {
      console.log(`  L${iss.line} [${iss.severity}/${iss.category}] ${iss.message}`);
      if (iss.suggestion) console.log(`    → ${iss.suggestion}`);
    }
  }
} else {
  console.log('\n⚠ JSON 解析失败');
}

if (managed && !managed.killed) { try { managed.kill(); } catch {} }
process.exit(0);
