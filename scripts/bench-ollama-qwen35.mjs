/**
 * Ollama 本地模型上限测试 — 针对 qwen3.5:4b
 *
 * 测试指标：
 *   - TTFT (Time To First Token) — 流式首字符延迟
 *   - 总耗时
 *   - 输出字符数
 *   - 字符/s
 *   - JSON 解析成功率
 *   - issues 数量、summary 是否合理
 *
 * 复用项目里 buildAnalyzeCodePrompt 的精神，但本脚本独立 — 直接打 ollama。
 *
 * 跑：node scripts/bench-ollama-qwen35.mjs
 */

import { writeFile, mkdir } from 'fs/promises';

const MODEL = process.env.MODEL || 'qwen3.5:4b';
// 用 ollama 原生 /api/chat（不是 OpenAI 兼容），才能传 options 控制 num_gpu / num_ctx
const ENDPOINT = process.env.ENDPOINT || 'http://localhost:11434/api/chat';
const NUM_CTX = parseInt(process.env.NUM_CTX || '4096', 10);
const NUM_GPU = parseInt(process.env.NUM_GPU || '-1', 10); // -1 = 全部 layer 到 GPU
const OUT_DIR = 'bench-results';
await mkdir(OUT_DIR, { recursive: true });

// ---------------- 测试用例 ----------------

const SYSTEM = `你是一位资深的算法竞赛教练和编程导师，专注于辅导大学生学习 C++ 和 Python。

你的风格：
- 直接、犀利、不说废话
- 优先指出最关键的问题（按严重程度排序）
- 给出可执行的具体修改建议，不空谈
- 给 Big-O 表达式
- 输出严格 JSON 格式，不包含 \`\`\`json 标记或任何额外文字`;

function userPrompt({ title, statement, code, language }) {
  return `当前题目：${title}
${statement}

学生当前 ${language} 代码：
\`\`\`${language}
${code}
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
}

const CASES = [
  {
    id: 'easy-cin-untied',
    label: '简单（50行，cin 未解绑 → TLE 风险）',
    title: 'A+B problem with N pairs',
    statement: '给定 N (N≤1e6) 对整数，输出每对的和。',
    language: 'cpp',
    code: `#include <iostream>
using namespace std;

int main() {
    int n;
    cin >> n;
    for (int i = 0; i < n; i++) {
        int a, b;
        cin >> a >> b;
        cout << a + b << endl;
    }
    return 0;
}`,
  },
  {
    id: 'medium-on2-bug',
    label: '中等（80行，O(n²) bug + map 滥用）',
    title: 'Two Sum (n ≤ 1e5)',
    statement: '给定数组 a 和目标 t，找出两个不同下标 i<j 使得 a[i]+a[j]=t，输出任意一对。N≤1e5。',
    language: 'cpp',
    code: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n, t;
    cin >> n >> t;
    vector<int> a(n);
    for (int i = 0; i < n; i++) cin >> a[i];

    map<int, int> mp;
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < n; j++) {
            if (i == j) continue;
            if (a[i] + a[j] == t) {
                cout << i << " " << j << endl;
                return 0;
            }
        }
    }
    cout << -1 << endl;
    return 0;
}`,
  },
  {
    id: 'hard-dp-base-case-bug',
    label: '复杂（150行，DP 滚动数组 base case 错）',
    title: '0/1 背包',
    statement: 'N 个物品，背包容量 W，第 i 个物品 weight[i] valued[i]，求最大价值。N≤1000, W≤1e4。',
    language: 'cpp',
    code: `#include <bits/stdc++.h>
using namespace std;

int n, W;
int w[1005], v[1005];
int dp[10005];

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);

    cin >> n >> W;
    for (int i = 1; i <= n; i++) cin >> w[i] >> v[i];

    // dp[j] = 容量为 j 时的最大价值
    // 滚动数组优化：从右往左
    for (int i = 1; i <= n; i++) {
        for (int j = 0; j <= W; j++) {  // BUG: 应该从右往左 j = W down to w[i]
            if (j >= w[i]) {
                dp[j] = max(dp[j], dp[j - w[i]] + v[i]);
            }
        }
    }

    cout << dp[W] << endl;
    return 0;
}`,
  },
];

// ---------------- 调用工具 ----------------

async function streamChat({ model, system, user }) {
  const startedAt = Date.now();
  let firstTokenAt = null;
  let totalChars = 0;
  let chunks = [];
  let promptTokens = null;
  let completionTokens = null;
  // ollama /api/chat 在 done=true 时给 server-side 计时（纳秒）
  let serverEvalCount = null;
  let serverEvalDurationNs = null;
  let serverPromptEvalCount = null;
  let serverLoadDurationNs = null;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user + ' /no_think' }, // 兜底关思考
      ],
      stream: true,
      think: false, // ollama 原生
      options: {
        temperature: 0.3,
        num_ctx: NUM_CTX,
        num_gpu: NUM_GPU,
        num_predict: 2048,
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  // ollama /api/chat 流式响应：每行一个 JSON
  // { "model":"...", "message":{"role":"assistant","content":"..."}, "done":false }
  // 最后一帧：{ "done":true, "total_duration":..., "load_duration":..., "prompt_eval_count":..., "eval_count":..., "eval_duration":... }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        const delta = evt?.message?.content ?? '';
        if (delta) {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          totalChars += delta.length;
          chunks.push(delta);
        }
        if (evt?.done) {
          serverEvalCount = evt.eval_count ?? null;
          serverEvalDurationNs = evt.eval_duration ?? null;
          serverPromptEvalCount = evt.prompt_eval_count ?? null;
          serverLoadDurationNs = evt.load_duration ?? null;
          completionTokens = evt.eval_count ?? null;
          promptTokens = evt.prompt_eval_count ?? null;
        }
      } catch {}
    }
  }

  const endedAt = Date.now();
  const fullText = chunks.join('');
  // server 端 token/s
  const serverTokPerSec =
    serverEvalCount && serverEvalDurationNs
      ? (serverEvalCount * 1e9) / serverEvalDurationNs
      : null;
  return {
    fullText,
    ttftMs: firstTokenAt ? firstTokenAt - startedAt : null,
    totalMs: endedAt - startedAt,
    totalChars,
    promptTokens,
    completionTokens,
    serverTokPerSec,
    serverLoadMs: serverLoadDurationNs ? serverLoadDurationNs / 1e6 : null,
  };
}

// 剥 <think> 块和 ```json 围栏
function stripWrappers(s) {
  let t = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  // 找首个 { 和最后一个 }
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t;
}

function tryParse(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, err: String(e.message || e) };
  }
}

// ---------------- 跑！ ----------------

console.log(`\n🚀 Bench: ${MODEL} via ${ENDPOINT}\n${'-'.repeat(60)}`);

const results = [];
for (const c of CASES) {
  console.log(`\n📋 [${c.id}] ${c.label}`);
  const user = userPrompt(c);
  let r, err;
  try {
    r = await streamChat({ model: MODEL, system: SYSTEM, user });
  } catch (e) {
    err = String(e.message || e);
    console.log(`   ❌ ${err}`);
    results.push({ case: c, err });
    continue;
  }

  const stripped = stripWrappers(r.fullText);
  const parsed = tryParse(stripped);
  const cps = r.totalChars / (r.totalMs / 1000);

  console.log(`   ⏱️  TTFT ${r.ttftMs}ms · 总 ${r.totalMs}ms (${(r.totalMs / 1000).toFixed(1)}s) · load ${(r.serverLoadMs ?? 0).toFixed(0)}ms`);
  console.log(`   📊 ${r.totalChars} chars · ${cps.toFixed(0)} chars/s`);
  if (r.completionTokens)
    console.log(
      `   🎯 ${r.completionTokens} tok / ${r.promptTokens} prompt · server ${r.serverTokPerSec?.toFixed(1)} tok/s`,
    );
  console.log(`   🧬 JSON parse: ${parsed.ok ? '✅' : '❌ ' + parsed.err.slice(0, 80)}`);
  if (parsed.ok) {
    const v = parsed.value;
    console.log(`   📌 issues: ${(v.issues ?? []).length} · verdict: ${v.verdict ?? '?'}`);
    console.log(`   💬 summary: ${(v.summary ?? '').slice(0, 100)}`);
  }

  results.push({
    case: c,
    raw: r.fullText,
    stripped,
    parsed: parsed.ok ? parsed.value : null,
    parseError: parsed.ok ? null : parsed.err,
    metrics: {
      ttftMs: r.ttftMs,
      totalMs: r.totalMs,
      totalChars: r.totalChars,
      charsPerSec: cps,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      serverTokPerSec: r.serverTokPerSec,
      serverLoadMs: r.serverLoadMs,
    },
  });
}

// ---------------- 写报告 ----------------

const tsId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const reportPath = `${OUT_DIR}/local-model-bench-${tsId}.md`;
const jsonPath = `${OUT_DIR}/local-model-bench-${tsId}.json`;

const ok = results.filter((r) => !r.err && r.parsed);
const avgTtft = ok.length ? Math.round(ok.reduce((s, r) => s + r.metrics.ttftMs, 0) / ok.length) : 0;
const avgTotal = ok.length ? Math.round(ok.reduce((s, r) => s + r.metrics.totalMs, 0) / ok.length) : 0;
const avgCps = ok.length ? Math.round(ok.reduce((s, r) => s + r.metrics.charsPerSec, 0) / ok.length) : 0;

let md = `# Ollama \`${MODEL}\` 实时批注能力测试

**时间**：${new Date().toLocaleString('zh-CN')}
**Endpoint**：\`${ENDPOINT}\`
**Prompt**：模拟项目内 analyze-code 的 system + user JSON-output 提示

## 总体指标

| 指标 | 数值 |
|---|---|
| 测试用例 | ${results.length} |
| JSON 解析成功 | ${ok.length}/${results.length} |
| 平均 TTFT | ${avgTtft}ms |
| 平均总耗时 | ${avgTotal}ms (${(avgTotal / 1000).toFixed(1)}s) |
| 平均吞吐 | ${avgCps} chars/s |

`;

for (const r of results) {
  md += `\n---\n\n## ${r.case.id} — ${r.case.label}\n\n`;
  md += `**题目**：${r.case.title}\n\n`;
  if (r.err) {
    md += `❌ **失败**：\n\n\`\`\`\n${r.err}\n\`\`\`\n`;
    continue;
  }
  md += `### 指标\n\n`;
  md += `- TTFT: **${r.metrics.ttftMs}ms**\n`;
  md += `- 总耗时: **${r.metrics.totalMs}ms** (${(r.metrics.totalMs / 1000).toFixed(1)}s)`;
  if (r.metrics.serverLoadMs) md += ` · load ${r.metrics.serverLoadMs.toFixed(0)}ms`;
  md += `\n`;
  md += `- 输出: ${r.metrics.totalChars} chars · **${r.metrics.charsPerSec.toFixed(0)} chars/s**\n`;
  if (r.metrics.completionTokens)
    md += `- Token: ${r.metrics.completionTokens} 出 / ${r.metrics.promptTokens} 入`;
  if (r.metrics.serverTokPerSec)
    md += ` · **server ${r.metrics.serverTokPerSec.toFixed(1)} tok/s**`;
  md += `\n`;
  md += `- JSON 解析: ${r.parsed ? '✅' : '❌ ' + r.parseError}\n\n`;

  if (r.parsed) {
    md += `### 摘要\n\n> ${r.parsed.summary ?? '(空)'}\n\n`;
    md += `**Verdict**: \`${r.parsed.verdict ?? '?'}\` · **Complexity**: \`${r.parsed.complexity ?? '?'}\`\n\n`;
    md += `### Issues (${(r.parsed.issues ?? []).length})\n\n`;
    for (const iss of r.parsed.issues ?? []) {
      md += `- **L${iss.line}** \`${iss.severity}\`: ${iss.message}\n`;
      if (iss.suggestion) md += `  - 💡 ${iss.suggestion}\n`;
    }
  }

  md += `\n<details><summary>原始输出</summary>\n\n\`\`\`\n${r.raw}\n\`\`\`\n\n</details>\n`;
}

await writeFile(reportPath, md, 'utf8');
await writeFile(jsonPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`\n✓ Report: ${reportPath}`);
console.log(`✓ Raw:    ${jsonPath}`);
