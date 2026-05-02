/**
 * 在浏览器里调用项目的 AIClient（走 vite dev proxy 实际访问 ollama）
 * 测端到端速度，确认 client.ts 改造后浏览器调用也能跑满 GPU。
 */
import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:5173';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const p = await ctx.newPage();

p.on('console', (m) => {
  if (m.type() === 'error') console.log('  [err]', m.text().slice(0, 300));
  else if (m.text().startsWith('BENCH')) console.log('  [page]', m.text());
});
p.on('pageerror', (e) => console.log('  [pageerr]', e.message));
p.on('response', (r) => {
  if (r.url().includes('11434') || r.url().includes('api/chat') || r.url().includes('ai-proxy')) {
    console.log(`  [net] ${r.status()} ${r.url().slice(0, 140)}`);
  }
});

await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(500);

// 在页面里 import 项目的 AIClient（vite 模块化），实测
const result = await p.evaluate(async () => {
  // 动态 import 项目模块
  const mod = await import('/src/core/ai/client.ts');
  const cfg = {
    provider: 'ollama',
    baseUrl: 'http://localhost:11434/v1/chat/completions',
    apiKey: '',
    model: 'qwen3.5:4b',
    maxTokens: 512,
    temperature: 0.3,
    timeoutMs: 60000,
    maxRetries: 0,
  };
  const c = new mod.AIClient(cfg);

  // 测 1: 短 prompt，非流式（看 load + 短输出）
  const t0 = performance.now();
  let firstChunkAt = null;
  let chars = 0;
  const stream = c.chatStream({
    messages: [
      { role: 'system', content: '你是简洁的助手。' },
      { role: 'user', content: '用一句话解释什么是 C++ 的栈（stack）。' },
    ],
    onChunk: (delta, _acc) => {
      if (firstChunkAt === null) firstChunkAt = performance.now();
      chars += delta.length;
    },
  });
  let acc = '';
  for await (const d of stream) acc += d;
  const t1 = performance.now();

  console.log('BENCH', JSON.stringify({
    ttftMs: Math.round((firstChunkAt ?? t1) - t0),
    totalMs: Math.round(t1 - t0),
    chars,
    output: acc.slice(0, 200),
  }));

  return {
    ttftMs: Math.round((firstChunkAt ?? t1) - t0),
    totalMs: Math.round(t1 - t0),
    chars,
    output: acc,
  };
});

console.log('\n📊 浏览器端 ollama 调用结果:');
console.log(`   TTFT  : ${result.ttftMs}ms`);
console.log(`   Total : ${result.totalMs}ms (${(result.totalMs / 1000).toFixed(1)}s)`);
console.log(`   Chars : ${result.chars}`);
console.log(`   chars/s: ${(result.chars / (result.totalMs / 1000)).toFixed(0)}`);
console.log(`\n输出：\n${result.output}\n`);

await b.close();
