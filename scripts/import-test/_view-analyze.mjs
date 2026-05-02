/**
 * 入库 E 题 → 写一段 buggy 代码 → 触发「分析代码」→ 截图 AI 分析结果
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const VITE = 'http://127.0.0.1:5173';
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=').map((s) => s.trim())),
);
const CFG = {
  provider: env.AI_COACH_PROVIDER || 'minimax',
  baseUrl: env.AI_COACH_BASE_URL,
  apiKey: env.AI_COACH_KEY,
  model: env.AI_COACH_MODEL || 'MiniMax-M2',
  maxTokens: 8000, temperature: 0.3, timeoutMs: 180_000, maxRetries: 2,
  fastLane: { enabled: false, baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:4b', numCtx: 8192 },
};

const PROCESSED = JSON.parse(readFileSync('logs/imports/2026-04-28T14-29-34_school-oj.processed.json', 'utf8'));

// 故意有 bug 的 E 题答案（漏了补 0 + 友元声明位置错）
const BUGGY_CODE = `#include <iostream>
using namespace std;

class Time;

class Date {
    int year, month, day;
public:
    Date(int y, int m, int d) : year(y), month(m), day(d) {}
    friend void display(const Date &d, const Time &t);
};

class Time {
    int hour, minute, second;
public:
    Time(int h, int m, int s) : hour(h), minute(m), second(s) {}
    friend void display(const Date &d, const Time &t);
};

// bug: 没有补 0，直接输出
void display(const Date &d, const Time &t) {
    cout << d.year << "-" << d.month << "-" << d.day
         << " " << t.hour << ":" << t.minute << ":" << t.second << endl;
}

int main() {
    int t;
    cin >> t;
    while (t--) {
        int y, m, d, h, mi, s;
        cin >> y >> m >> d >> h >> mi >> s;
        Date date(y, m, d);
        Time time(h, mi, s);
        display(date, time);
    }
    return 0;
}
`;

const browser = await chromium.launch({
  executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true,
});
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => process.stdout.write(`💥 ${e.message}\n`));

await page.goto(VITE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.evaluate(async (cfg) => {
  localStorage.setItem('aicc.aiConfig.v1', JSON.stringify(cfg));
  localStorage.setItem('aicc.onboarding.v1', 'done');
  localStorage.setItem('aicc.learning.dismissed.v1', new Date().toISOString().slice(0, 10));
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase('aicc');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
    setTimeout(resolve, 2000);
  });
}, CFG);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);

console.log('1. 入库 E 题（minimax parseProblem ~25s）...');
const t0 = Date.now();
await page.evaluate((p) => window.__aiccStore.getState().handleImportPayload(p), PROCESSED);
let problem = null;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => window.__aiccStore.getState());
  if (st.problems.length > 0 && st.problems[0].difficulty) {
    problem = st.problems[0];
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s: ✓ 入库 + 解析完成 (${problem.title})`);
    break;
  }
}
if (!problem) { console.log('❌ 入库失败'); await browser.close(); process.exit(1); }

console.log('\n2. 写 buggy 代码到 main.cpp...');
await page.evaluate((code) => {
  const st = window.__aiccStore.getState();
  const fileId = st.activeFileIdByScope[st.activeProblemId];
  // 通过 store 的 updateFile 写
  return st.updateFile?.(fileId, { content: code }) ?? st.saveFileContent?.(fileId, code) ?? (() => {
    // fallback: 直接调 storage + setState
    const files = st.filesByScope[st.activeProblemId] || [];
    const updated = files.map((f) => f.id === fileId ? { ...f, content: code, updatedAt: Date.now() } : f);
    window.__aiccStore.setState({
      filesByScope: { ...st.filesByScope, [st.activeProblemId]: updated },
    });
  })();
}, BUGGY_CODE);
await page.waitForTimeout(500);
console.log('   ✓ 代码已写入');

console.log('\n3. 点击「分析代码」按钮...');
const analyzeBtn = await page.$('button:has-text("分析代码")');
if (!analyzeBtn) { console.log('❌ 未找到分析按钮'); await browser.close(); process.exit(1); }
await analyzeBtn.click();

console.log('   等 AI 流式响应（最多 90s）...');
let analysisDone = false;
const t1 = Date.now();
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => {
    const s = window.__aiccStore.getState();
    return {
      streaming: s.coach?.isStreaming,
      lastReview: s.reviewsByScope?.[s.activeProblemId]?.[0]?.summary?.length || 0,
    };
  });
  if (i % 10 === 9) console.log(`   ${i + 1}s: streaming=${st.streaming}, summary 长度=${st.lastReview}`);
  if (!st.streaming && st.lastReview > 50) {
    analysisDone = true;
    console.log(`   ${((Date.now() - t1) / 1000).toFixed(1)}s: ✓ AI 分析完成 (${st.lastReview} 字)`);
    break;
  }
}

await page.waitForTimeout(2000);
const screenshot = `logs/imports/_analyze-view-${Date.now()}.png`;
await page.screenshot({ path: screenshot, fullPage: true });
console.log(`\n📸 ${screenshot}`);

const review = await page.evaluate(() => {
  const s = window.__aiccStore.getState();
  return s.reviewsByScope?.[s.activeProblemId]?.[0];
});
if (review) {
  console.log('\n━━━ AI 分析结果 ━━━');
  console.log('summary:', review.summary?.slice(0, 800));
  console.log('\nissues count:', review.issues?.length || 0);
  if (review.issues?.length) {
    for (const issue of review.issues.slice(0, 5)) {
      console.log(`  [${issue.severity}] ${issue.message?.slice(0, 150)}`);
    }
  }
}

await browser.close();
