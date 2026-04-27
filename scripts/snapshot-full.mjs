/**
 * 全功能交互测试 + 截图（用真实 AI）
 * 从 .env.local 读 AI 配置注入到 playwright localStorage
 *
 * 每步包一个 step()，自动 try/catch + 截图 + 打印结果
 * 最后输出 ✓/✗ 报告，方便定位坏掉的按钮
 */
import { chromium } from 'playwright';
import { mkdir, readFile } from 'fs/promises';

const URL = 'http://127.0.0.1:5173';
const OUT = 'screenshots-full';
await mkdir(OUT, { recursive: true });

// 读 .env.local
const env = {};
try {
  const raw = await readFile('.env.local', 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch {
  console.log('⚠ 没找到 .env.local，AI 相关 step 会失败');
}
const AI_CONFIG = {
  provider: env.AI_COACH_PROVIDER || 'minimax',
  baseUrl: env.AI_COACH_BASE_URL || 'https://api.minimaxi.com/v1/text/chatcompletion_v2',
  apiKey: env.AI_COACH_KEY || '',
  model: env.AI_COACH_MODEL || 'MiniMax-M2',
  maxTokens: 8000,
  temperature: 0.3,
  timeoutMs: 180_000,
  maxRetries: 2,
};
console.log(`AI: provider=${AI_CONFIG.provider} model=${AI_CONFIG.model} key=${AI_CONFIG.apiKey ? AI_CONFIG.apiKey.slice(0, 8) + '…' : '(empty)'}`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

// 收集前端日志
const consoleErrors = [];
const pageErrors = [];
page.on('pageerror', (e) => {
  pageErrors.push(e.message);
  console.log('  [page-error]', e.message);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    consoleErrors.push(m.text());
    console.log('  [console-error]', m.text());
  }
});

// ─── step driver ───────────────────────────────────────────────────────
const results = [];
let stepIdx = 0;

// 强制关掉所有 modal / 下拉 / 右键菜单（防止前一步残留挡后续点击）
async function clearOverlays() {
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.evaluate(() => {
    // 用 store API 强关
    if (window.__aicc_clear__) {
      window.__aicc_clear__();
      return;
    }
  }).catch(() => {});
  await page.waitForTimeout(300);
  // 验证：所有 fixed inset-0 backdrop 是否消失？
  const overlays = await page.locator('.fixed.inset-0').count();
  if (overlays > 0) {
    // 大锤：直接点空白处
    await page.mouse.click(10, 500).catch(() => {});
    await page.waitForTimeout(200);
  }
}

async function step(name, fn) {
  stepIdx++;
  const tag = String(stepIdx).padStart(2, '0');
  console.log(`\n→ ${tag} ${name}`);
  try {
    await clearOverlays();
    await fn(tag);
    results.push({ tag, name, ok: true });
    console.log(`  ✓ pass`);
  } catch (e) {
    results.push({ tag, name, ok: false, err: e.message });
    console.log(`  ✗ FAIL: ${e.message}`);
    try {
      await page.screenshot({ path: `${OUT}/${tag}-FAIL.png` });
    } catch {}
  }
}
const shot = (tag, sub) => page.screenshot({ path: `${OUT}/${tag}-${sub}.png` });

// ─── go ────────────────────────────────────────────────────────────────
console.log(`→ open ${URL}`);
await page.goto(URL, { waitUntil: 'networkidle' });

// 清业务数据 + 注入 AI 配置
await page.evaluate(async (cfg) => {
  const idb = await import('https://esm.sh/idb@8');
  try {
    const db = await idb.openDB('ai-coding-coach', 2);
    await Promise.all([
      db.clear('problems'),
      db.clear('mistakes'),
      db.clear('sessions'),
      db.clear('events'),
      db.clear('files'),
    ]);
  } catch {}
  // 清所有 localStorage,然后注入 AI 配置
  localStorage.clear();
  if (cfg && cfg.apiKey) {
    localStorage.setItem('aicc.aiConfig.v1', JSON.stringify(cfg));
  }
}, AI_CONFIG);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// 关 toast
try {
  await page.locator('[data-sonner-toast] button').first().click({ timeout: 1000 });
} catch {}
await page.waitForTimeout(300);

// ═══════════════════════════════════════════════════════════════════════
// 1. 首屏验证
// ═══════════════════════════════════════════════════════════════════════
await step('首屏 - 默认 main.cpp tab 存在 + 编辑器有模板', async (tag) => {
  await shot(tag, 'home');
  const tabText = await page.locator('div[role="tab"]').first().innerText();
  if (!tabText.includes('main.cpp')) throw new Error(`expected main.cpp tab, got "${tabText}"`);
  const code = await page.evaluate(() => {
    const m = document.querySelector('.monaco-editor');
    return m ? m.textContent : '';
  });
  if (!code.includes('#include')) throw new Error('编辑器没有默认 cpp 模板');
});

// ═══════════════════════════════════════════════════════════════════════
// 2. 顶栏 active file badge 显示
// ═══════════════════════════════════════════════════════════════════════
await step('顶栏 active file badge 显示 CPP main.cpp', async () => {
  const badge = await page.locator('header').innerText();
  if (!/CPP\s*main\.cpp/i.test(badge)) throw new Error(`badge 内容: "${badge}"`);
});

// ═══════════════════════════════════════════════════════════════════════
// 3. AI 配置（确认）
// ═══════════════════════════════════════════════════════════════════════
let hasApiKey = false;
await step('打开设置 - 验证 API key 已配置', async (tag) => {
  await page.locator('header button[title*="设置"], header button:has(svg.lucide-settings)').first().click();
  await page.waitForTimeout(500);
  await shot(tag, 'settings');
  // 找 API Key 输入框（值超过 5 字符就算配过）
  hasApiKey = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input[type="password"], input[placeholder*="api" i], input[placeholder*="key" i]');
    for (const i of inputs) if (i.value && i.value.length > 5) return true;
    return false;
  });
  // 也读 localStorage 兜底
  if (!hasApiKey) {
    hasApiKey = await page.evaluate(() => {
      const raw = localStorage.getItem('aicc.aiConfig.v1');
      if (!raw) return false;
      try {
        const j = JSON.parse(raw);
        return !!(j.apiKey && j.apiKey.length > 5);
      } catch {
        return false;
      }
    });
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800); // 等动画完全消失
  if (!hasApiKey) console.log('  ⚠ API key 未配置，部分流程会跳过');
});

// ═══════════════════════════════════════════════════════════════════════
// 4. 新建文件下拉
// ═══════════════════════════════════════════════════════════════════════
await step('点 + 看新建下拉', async (tag) => {
  await page.locator('button[title="新建文件"]').click();
  await page.waitForTimeout(400);
  await shot(tag, 'create-dropdown');
  // 验证 6 个选项
  const opts = ['C++ 文件', 'Python 文件', 'C 文件', 'Markdown 笔记', '纯文本', '复制当前文件'];
  for (const o of opts) {
    const visible = await page.locator(`button:has-text("${o}")`).count();
    if (visible === 0) throw new Error(`下拉缺少: ${o}`);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// 5. 创建 Python 文件
// ═══════════════════════════════════════════════════════════════════════
await step('新建 Python → tab 出现 + 默认模板', async (tag) => {
  // 重新打开下拉（上一 step 后 clearOverlays 可能关了）
  await page.locator('button[title="新建文件"]').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Python 文件")').click();
  await page.waitForTimeout(800);
  await shot(tag, 'python-file');
  const tabs = await page.locator('div[role="tab"]').allInnerTexts();
  const hasPy = tabs.some((t) => /\.py/.test(t));
  if (!hasPy) throw new Error(`没有 .py tab, 当前: ${tabs.join(', ')}`);
  // 验证 active file badge 切到 python
  const headerText = await page.locator('header').innerText();
  if (!/PYTHON/i.test(headerText)) throw new Error(`badge 没切到 python: ${headerText}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 6. 创建 Markdown
// ═══════════════════════════════════════════════════════════════════════
await step('新建 Markdown → tab + raw 编辑模式', async (tag) => {
  await page.locator('button[title="新建文件"]').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Markdown 笔记")').click();
  await page.waitForTimeout(800);
  await shot(tag, 'md-raw');
  const previewBtn = await page.locator('button:has-text("预览")').count();
  if (previewBtn === 0) throw new Error('Markdown 文件没有预览按钮');
});

// ═══════════════════════════════════════════════════════════════════════
// 7. Markdown 预览切换
// ═══════════════════════════════════════════════════════════════════════
await step('Markdown 预览切换', async (tag) => {
  await page.locator('button:has-text("预览")').first().click();
  await page.waitForTimeout(500);
  await shot(tag, 'md-preview');
  // 应该有 .md-body 渲染
  const previewing = await page.locator('.md-body h1, .md-body h2').count();
  if (previewing === 0) throw new Error('预览模式未渲染 markdown');
});

// ═══════════════════════════════════════════════════════════════════════
// 8. 切回 main.cpp（点 tab）
// ═══════════════════════════════════════════════════════════════════════
await step('点 main.cpp tab 切回', async (tag) => {
  await page.locator('div[role="tab"]:has-text("main.cpp")').click();
  await page.waitForTimeout(400);
  await shot(tag, 'switch-back');
  const headerText = await page.locator('header').innerText();
  if (!/CPP\s*main\.cpp/i.test(headerText)) throw new Error(`没切回 cpp: ${headerText}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 9. 复制当前文件 → main-v2.cpp
// ═══════════════════════════════════════════════════════════════════════
await step('复制当前文件 → main-v2.cpp', async (tag) => {
  await page.locator('button[title="新建文件"]').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("复制当前文件")').click();
  await page.waitForTimeout(800);
  await shot(tag, 'duplicate');
  const tabs = await page.locator('div[role="tab"]').allInnerTexts();
  const hasV2 = tabs.some((t) => /v2\.cpp/.test(t));
  if (!hasV2) throw new Error(`没有 v2.cpp, 当前: ${tabs.join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 10. 双击重命名
// ═══════════════════════════════════════════════════════════════════════
await step('双击 tab 重命名', async (tag) => {
  const v2Tab = page.locator('div[role="tab"]:has-text("v2.cpp")').first();
  await v2Tab.locator('span').filter({ hasText: /v2\.cpp/ }).first().dblclick();
  await page.waitForTimeout(300);
  // 输入新名
  await page.keyboard.press('Control+A');
  await page.keyboard.type('brute.cpp');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await shot(tag, 'renamed');
  const tabs = await page.locator('div[role="tab"]').allInnerTexts();
  const hasBrute = tabs.some((t) => /brute\.cpp/.test(t));
  if (!hasBrute) throw new Error(`重命名失败, 当前: ${tabs.join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 11. 右键菜单
// ═══════════════════════════════════════════════════════════════════════
await step('右键 tab → 看菜单', async (tag) => {
  const tab = page.locator('div[role="tab"]:has-text("brute.cpp")').first();
  await tab.click({ button: 'right' });
  await page.waitForTimeout(400);
  await shot(tag, 'context-menu');
  // 验证菜单项
  const items = ['重命名', '复制', '置顶', '加入对拍', '删除'];
  let found = 0;
  for (const it of items) {
    if ((await page.locator(`button:has-text("${it}")`).count()) > 0) found++;
  }
  if (found < 4) throw new Error(`右键菜单项过少: ${found}/5`);
  // 关掉
  await page.mouse.click(50, 400);
  await page.waitForTimeout(200);
});

// ═══════════════════════════════════════════════════════════════════════
// 12. 置顶 brute.cpp
// ═══════════════════════════════════════════════════════════════════════
await step('右键 → 置顶 brute.cpp', async (tag) => {
  const tab = page.locator('div[role="tab"]:has-text("brute.cpp")').first();
  await tab.click({ button: 'right' });
  await page.waitForTimeout(300);
  await page.locator('button:has-text("置顶"):not(:has-text("取消"))').click();
  await page.waitForTimeout(500);
  await shot(tag, 'pinned');
  // 重新查 brute.cpp 应该有 pin 图标
  const pinned = await page.evaluate(() => {
    const tabs = document.querySelectorAll('div[role="tab"]');
    for (const t of tabs) {
      if (t.textContent.includes('brute.cpp')) {
        return !!t.querySelector('svg.lucide-pin');
      }
    }
    return false;
  });
  if (!pinned) throw new Error('置顶后 pin 图标没显示');
});

// ═══════════════════════════════════════════════════════════════════════
// 13. 对拍勾选 main.cpp + brute.cpp → 看对拍按钮
// ═══════════════════════════════════════════════════════════════════════
await step('勾选两个 cpp tab → 出现对拍按钮', async (tag) => {
  // 用 evaluate 直接点对拍勾选框
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('div[role="tab"]');
    let i = 0;
    for (const t of tabs) {
      const name = t.textContent || '';
      if (name.includes('.cpp') && i < 2) {
        const checkBtn = t.querySelector('button[title*="对拍"]');
        if (checkBtn) checkBtn.click();
        i++;
      }
    }
  });
  await page.waitForTimeout(600);
  await shot(tag, 'diff-selected');
  const diffBtn = await page.locator('button:has-text("对拍")').count();
  if (diffBtn === 0) throw new Error('对拍按钮没出现');
});

// ═══════════════════════════════════════════════════════════════════════
// 14. 点对拍 → 看任务和 modal
// ═══════════════════════════════════════════════════════════════════════
if (hasApiKey) {
  await step('点对拍按钮 → DiffResultViewer 弹出', async (tag) => {
    // 上一 step 选中了两个 cpp，这里点对拍按钮。button 文本严格匹配「对拍」
    await page.locator('button[title*="对比"], button:has-text("对拍"):not(:has-text("拍设"))').first().click();
    await page.waitForTimeout(3000);
    await shot(tag, 'diff-modal-running');
    const modal = await page.locator('text=AI 对比报告').count();
    if (modal === 0) throw new Error('对拍 modal 没出现');
    // 等流式输出 ~10s 看是否有内容
    await page.waitForTimeout(15000);
    await shot(tag, 'diff-modal-progress');
    // 关掉 modal
    await page.locator('button[title*="取消"], div.glass-card button:has(svg.lucide-x)').last().click().catch(() => {});
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });
} else {
  console.log('⚠ skip 14（无 API key）');
}

// ═══════════════════════════════════════════════════════════════════════
// 15. Ctrl+P 命令面板
// ═══════════════════════════════════════════════════════════════════════
await step('Ctrl+P 打开命令面板', async (tag) => {
  await page.keyboard.press('Control+P');
  await page.waitForTimeout(500);
  await shot(tag, 'cmdp-empty');
  const palette = await page.locator('input[placeholder*="搜索"]').count();
  if (palette === 0) throw new Error('Ctrl+P 没打开命令面板');
});

await step('命令面板搜索 + 跳转', async (tag) => {
  // 重新打开面板（clearOverlays 会关掉）
  await page.keyboard.press('Control+P');
  await page.waitForTimeout(500);
  await page.keyboard.type('brute');
  await page.waitForTimeout(400);
  await shot(tag, 'cmdp-search');
  const items = await page.locator('li:has-text("brute.cpp")').count();
  if (items === 0) throw new Error('搜 brute 没结果');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  await shot(tag, 'cmdp-jumped');
  // 验证 active file 变成 brute.cpp
  const headerText = await page.locator('header').innerText();
  if (!/brute\.cpp/i.test(headerText)) throw new Error(`没跳到 brute.cpp: ${headerText}`);
});

// ═══════════════════════════════════════════════════════════════════════
// 16. 录入题目（真 AI 解析）
// ═══════════════════════════════════════════════════════════════════════
const SAMPLE_PROBLEM = `两数之和

给定一个整数数组 nums 和一个整数目标值 target，请你在该数组中找出和为目标值的那两个整数，并返回它们的数组下标。
你可以假设每种输入只会对应一个答案。但是，数组中同一个元素不能使用两次。

约束：
2 ≤ nums.length ≤ 10^4
-10^9 ≤ nums[i] ≤ 10^9
-10^9 ≤ target ≤ 10^9

示例：
输入：nums=[2,7,11,15],target=9
输出：[0,1]`;

if (hasApiKey) {
  await step('录入题目 → AI 解析 → 题目激活', async (tag) => {
    await page.locator('header button:has-text("录入题目")').click();
    await page.waitForTimeout(500);
    // ProblemEditor 的 textarea 用 class 精确匹配（monaco 编辑器也有 textarea）
    await page.locator('textarea.input.font-mono').first().fill(SAMPLE_PROBLEM);
    await shot(tag, 'problem-editor-filled');
    await page.locator('button:has-text("解析")').click();
    // toast 关掉，等 AI 解析完
    await page.waitForTimeout(500);
    // 等最多 60s 让题目出现在 sidebar 题目库
    let activated = false;
    for (let i = 0; i < 60; i++) {
      await page.waitForTimeout(1000);
      const pTitle = await page.locator('header').innerText();
      if (/两数之和|Two Sum/i.test(pTitle)) {
        activated = true;
        break;
      }
    }
    await shot(tag, 'problem-active');
    if (!activated) throw new Error('60s 内题目没解析成');
  });
} else {
  console.log('⚠ skip 16（无 API key）');
}

// ═══════════════════════════════════════════════════════════════════════
// 17. Sidebar 切换：错题本 / 历史 / 仪表盘
// ═══════════════════════════════════════════════════════════════════════
// sidebar 顶层是 div.w-14（不是 aside）
const sidebarBtns = () => page.locator('div.w-14 > button');

await step('Sidebar 题目库展开', async (tag) => {
  const cnt = await sidebarBtns().count();
  if (cnt < 4) throw new Error(`sidebar 按钮数 ${cnt} < 4`);
  await sidebarBtns().nth(0).click();
  await page.waitForTimeout(400);
  await shot(tag, 'sidebar-problems');
});

await step('Sidebar 错题本', async (tag) => {
  await sidebarBtns().nth(1).click();
  await page.waitForTimeout(400);
  await shot(tag, 'sidebar-mistakes');
});

await step('Sidebar 历史', async (tag) => {
  await sidebarBtns().nth(2).click();
  await page.waitForTimeout(400);
  await shot(tag, 'sidebar-history');
});

await step('Sidebar 仪表盘', async (tag) => {
  await sidebarBtns().nth(3).click();
  await page.waitForTimeout(600);
  await shot(tag, 'sidebar-dashboard');
});

// ═══════════════════════════════════════════════════════════════════════
// 18. 触发分析（AI 真跑）
// ═══════════════════════════════════════════════════════════════════════
if (hasApiKey) {
  await step('点分析代码 → 流式 AI 反馈', async (tag) => {
    // 切到 main.cpp
    await page.keyboard.press('Control+P');
    await page.waitForTimeout(500);
    await page.keyboard.type('main.cpp');
    await page.waitForTimeout(400);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);

    // 点击编辑器内部 textarea，monaco 里的 hidden textarea
    const editorBox = await page.locator('.monaco-editor').first().boundingBox();
    if (editorBox) {
      await page.mouse.click(editorBox.x + 100, editorBox.y + 100);
      await page.waitForTimeout(200);
    }
    await page.keyboard.press('Control+A');
    await page.keyboard.type(`#include <bits/stdc++.h>
using namespace std;
int main(){
  int n; cin>>n;
  vector<int> a(n);
  for(int i=0;i<=n;i++) cin>>a[i];
  int s=0;
  for(int i=0;i<n;i++) s+=a[i];
  cout<<s;
}`);
    await page.waitForTimeout(500);
    await shot(tag, 'before-analyze');
    await page.locator('header button:has-text("分析代码")').click();
    await page.waitForTimeout(2000);
    await shot(tag, 'analyzing');
    // 等任务完成 ~30s
    let done = false;
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(1000);
      const fb = await page.locator('aside, .feedback').innerText().catch(() => '');
      if (/已分析|无问题|\d+\s*个|总评/i.test(fb)) {
        done = true;
        break;
      }
    }
    await shot(tag, 'after-analyze');
    if (!done) throw new Error('40s 内分析没完成');
    // 也截一下编辑器，看 inline decoration
    await shot(tag, 'with-decorations');
  });
} else {
  console.log('⚠ skip 18（无 API key）');
}

// ═══════════════════════════════════════════════════════════════════════
// 19. 删除文件确认对话框
// ═══════════════════════════════════════════════════════════════════════
await step('右键 brute.cpp → 删除（取消）', async (tag) => {
  // 先 dialog handler
  page.once('dialog', async (d) => {
    console.log('  dialog: ' + d.message().slice(0, 60));
    await d.dismiss();
  });
  const tab = page.locator('div[role="tab"]:has-text("brute.cpp")').first();
  await tab.click({ button: 'right' });
  await page.waitForTimeout(300);
  await page.locator('button:has-text("删除")').click();
  await page.waitForTimeout(500);
  await shot(tag, 'delete-dialog');
  // brute.cpp 仍在
  const tabs = await page.locator('div[role="tab"]').allInnerTexts();
  const has = tabs.some((t) => /brute\.cpp/.test(t));
  if (!has) throw new Error('取消删除后 brute.cpp 不在了');
});

// ═══════════════════════════════════════════════════════════════════════
// 20. 重新加载 → 验证持久化
// ═══════════════════════════════════════════════════════════════════════
await step('刷新 → 文件 + 题目持久化', async (tag) => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  // 关 toast
  try {
    await page.locator('[data-sonner-toast] button').first().click({ timeout: 1000 });
  } catch {}
  await page.waitForTimeout(300);
  await shot(tag, 'after-reload');
  const tabs = await page.locator('div[role="tab"]').allInnerTexts();
  const need = ['main.cpp', 'brute.cpp'];
  for (const n of need) {
    const has = tabs.some((t) => t.includes(n));
    if (!has) throw new Error(`刷新后丢了 ${n}, 当前: ${tabs.join(', ')}`);
  }
});

// ─── 收尾 ──────────────────────────────────────────────────────────────
await browser.close();

console.log('\n═══════════════════════════════════════');
console.log('  测试报告');
console.log('═══════════════════════════════════════');
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`  ${r.ok ? '✓' : '✗'} ${r.tag} ${r.name}${r.err ? '  → ' + r.err : ''}`);
}
console.log(`\n  ${passed}/${results.length} passed`);
if (consoleErrors.length) console.log(`  Console errors: ${consoleErrors.length}`);
if (pageErrors.length) console.log(`  Page errors: ${pageErrors.length}`);
process.exit(failed.length > 0 ? 1 : 0);
