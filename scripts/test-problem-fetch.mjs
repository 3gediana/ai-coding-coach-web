// 端到端测试 /problem-fetch 代理 + 客户端解析
import { fetchAndParseProblem } from '../src/lib/fetchProblem.ts';

// fetchProblem 调 fetch('/problem-fetch?...')，但脚本里没有相对路径——做个垫片
globalThis.fetch_orig = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof input === 'string' && input.startsWith('/problem-fetch')) {
    input = 'http://127.0.0.1:5173' + input;
  }
  return globalThis.fetch_orig(input, init);
};

const TARGETS = [
  'https://www.luogu.com.cn/problem/P1001',
  'https://atcoder.jp/contests/abc100/tasks/abc100_a',
  'http://poj.org/problem?id=1000',
  'https://acm.hdu.edu.cn/showproblem.php?pid=1000',
];

for (const url of TARGETS) {
  process.stdout.write(`\n━━━ ${url}\n`);
  try {
    const p = await fetchAndParseProblem(url);
    console.log(`  title: ${p.title}`);
    console.log(`  source: ${p.source.site} pid=${p.source.pid}`);
    console.log(`  statement.len: ${p.statement.length}`);
    console.log(`  statement 前 200: ${p.statement.slice(0, 200).replace(/\n/g, ' ')}`);
    console.log(`  examples: ${p.examples?.length}`);
    if (p.examples?.[0]) console.log(`    ex0.input: ${JSON.stringify(p.examples[0].input).slice(0, 100)}`);
    if (p.examples?.[0]) console.log(`    ex0.output: ${JSON.stringify(p.examples[0].output).slice(0, 80)}`);
    console.log(`  constraints: ${p.constraints || '—'}`);
    console.log(`  meta: ${JSON.stringify(p.meta)}`);
  } catch (e) {
    console.log(`  ✗ ERR ${e.code || ''} ${e.message}`);
  }
}
