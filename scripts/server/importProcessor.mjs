/**
 * 后端题目处理器（Node ESM，纯服务端，不依赖浏览器）
 *
 * 流程：
 *   1. 读 raw payload 文件
 *   2. 对每张图调 ollama /api/chat (qwen3.5 vision) → 文字描述
 *   3. 把描述就地替换 rawText 里的 [[IMG_N]] placeholder
 *   4. 写 processed payload 文件（含 imageRecognitions 字段）
 *   5. finally 块发 keep_alive=0 卸载模型释放显存
 *
 * CLI 用法：
 *   node scripts/server/importProcessor.mjs <raw.json>
 *   node scripts/server/importProcessor.mjs --watch logs/imports
 *
 * 编程接口（被 vite plugin 调用）：
 *   import { processImportFile } from './importProcessor.mjs'
 *   const out = await processImportFile('logs/imports/xxx.raw.json')
 *   // out: { processedPath, payload }
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { resolve as pathResolve, basename, dirname, join } from 'node:path';

// ─────────── 配置 ───────────

const OLLAMA_BASE = process.env.AICC_OLLAMA_BASE || 'http://127.0.0.1:11434';
// 视觉模型默认复用项目统一本地模型 qwen3.5:4b。
const VISION_MODEL = process.env.AICC_VISION_MODEL || 'qwen3.5:4b';
const VISION_PROMPT =
  '请简要描述这张图的内容。' +
  '如果是文字截图（题面/样例/公式）请逐字识别原文；' +
  '如果是流程图/算法图请描述结构和关键节点；' +
  '如果是数据示例请给出文字版本。' +
  '不要超过 300 字。';

// ─────────── 日志 ───────────

const c = {
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
};

function log(...args) {
  console.log(c.cyan('[processor]'), ...args);
}
function warn(...args) {
  console.warn(c.yellow('[processor]'), ...args);
}
function err(...args) {
  console.error(c.red('[processor]'), ...args);
}

// ─────────── ollama API ───────────

async function ollamaVisionDescribe(base64) {
  const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{ role: 'user', content: VISION_PROMPT, images: [base64] }],
      stream: false,
      options: { temperature: 0.2 },
      keep_alive: '5m', // 多张图复用，循环结束后再统一卸载
    }),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`ollama HTTP ${r.status}: ${text.slice(0, 200)}`);
  }
  const data = await r.json();
  return String(data.message?.content || '').trim();
}

async function ollamaUnload(model = VISION_MODEL) {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', keep_alive: 0 }),
    });
    log('已卸载', model);
  } catch (e) {
    warn('卸载失败（可忽略）', e.message);
  }
}

async function ollamaIsRunning() {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`${OLLAMA_BASE}/api/version`, { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  }
}

// ─────────── 主处理逻辑 ───────────

/**
 * 处理一个 raw 文件，输出 processed 文件
 * @param {string} rawPath - raw json 绝对路径
 * @returns {Promise<{processedPath: string, payload: object}>}
 */
export async function processImportFile(rawPath) {
  const raw = await readFile(rawPath, 'utf8');
  const payload = JSON.parse(raw);

  const startedAt = new Date().toISOString();
  log(c.gray(`处理 ${basename(rawPath)}`), `· ${payload.images?.length ?? 0} 图`);

  const recognitions = []; // {index, src, alt, description, error?, elapsedMs}

  // 没图直接跳过识图，但仍输出 processed 文件保持流程一致
  if (payload.images?.length > 0) {
    // 总开关（与浏览器侧 ollamaMode='disabled' 对齐）：
    //   AICC_OLLAMA=0  → 直接跳过识图，不发任何 ollama 请求
    //   AICC_OLLAMA=1  → 显式启用（默认行为）
    //   未设置          → fall back 到 ollamaIsRunning() 探测
    if (process.env.AICC_OLLAMA === '0') {
      warn('AICC_OLLAMA=0 已显式禁用 Ollama 模式，跳过识图');
    } else if (!(await ollamaIsRunning())) {
      warn('ollama 未运行，跳过识图（保留原始 placeholder）');
    } else {
      try {
        for (let i = 0; i < payload.images.length; i++) {
          const img = payload.images[i];
          const t0 = Date.now();
          // base64 优先，其次 data URI
          let b64 = img.base64;
          if (!b64 && img.src?.startsWith('data:')) {
            b64 = img.src.split(',')[1];
          }
          if (!b64) {
            warn(`图 ${i + 1} 无 base64，跳过`);
            recognitions.push({ index: i, src: img.src, alt: img.alt, error: 'no base64' });
            continue;
          }
          try {
            const description = await ollamaVisionDescribe(b64);
            const elapsed = Date.now() - t0;
            log(c.green(`✓`), `图 ${i + 1}/${payload.images.length}`, c.gray(`${(elapsed / 1000).toFixed(1)}s`), `${description.slice(0, 50)}...`);
            recognitions.push({ index: i, src: img.src, alt: img.alt, description, elapsedMs: elapsed });
          } catch (e) {
            err(`图 ${i + 1} 识别失败: ${e.message}`);
            recognitions.push({ index: i, src: img.src, alt: img.alt, error: e.message });
          }
        }
      } finally {
        await ollamaUnload();
      }
    }
  }

  // 把 [[IMG_N]] placeholder 就地替换为识别结果
  // 兼容 raw payload 没主动加 placeholder 的情况（直接附加在 rawText 末尾）
  let rawText = payload.rawText || '';
  if (recognitions.length > 0) {
    let appendedAny = false;
    for (const r of recognitions) {
      const marker = `[[IMG_${r.index + 1}]]`;
      const replacement = r.description
        ? `**[图 ${r.index + 1} 识别]** ${r.description}`
        : `**[图 ${r.index + 1} 识别失败]** ${r.error || '未知错误'}`;
      if (rawText.includes(marker)) {
        rawText = rawText.replace(marker, replacement);
      } else {
        // rawText 里没 placeholder → 末尾追加
        if (!appendedAny) {
          rawText += '\n\n---\n\n## 图片识别结果\n\n';
          appendedAny = true;
        }
        rawText += `${replacement}\n\n`;
      }
    }
  }

  const processed = {
    ...payload,
    rawText,
    imageRecognitions: recognitions,
    processedAt: new Date().toISOString(),
    processorMeta: {
      visionModel: VISION_MODEL,
      ollamaBase: OLLAMA_BASE,
      startedAt,
    },
  };

  // 写 processed 文件（同目录，扩展名换为 .processed.json）
  const processedPath = rawPath.endsWith('.raw.json')
    ? rawPath.replace(/\.raw\.json$/, '.processed.json')
    : rawPath.replace(/\.json$/, '.processed.json');
  await writeFile(processedPath, JSON.stringify(processed, null, 2), 'utf8');
  log(c.green(`→ ${basename(processedPath)}`), c.gray(`(${recognitions.filter((r) => r.description).length}/${recognitions.length} 识别成功)`));

  return { processedPath, payload: processed };
}

// ─────────── CLI ───────────

const isCLI = import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('importProcessor.mjs');

if (isCLI) {
  const args = process.argv.slice(2);

  if (args[0] === '--watch') {
    const dir = pathResolve(args[1] || 'logs/imports');
    log(`监听目录 ${dir}`);
    const seen = new Set();
    // 启动时扫一遍未处理的
    const files = await readdir(dir).catch(() => []);
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      if (f.endsWith('.processed.json')) continue;
      const processed = join(dir, f.replace(/\.json$/, '.processed.json'));
      if (!existsSync(processed)) {
        seen.add(f);
        await processImportFile(join(dir, f)).catch((e) => err(f, e.message));
      } else {
        seen.add(f);
      }
    }
    // 监听新文件
    watch(dir, async (event, filename) => {
      if (!filename || !filename.endsWith('.json') || filename.endsWith('.processed.json')) return;
      if (seen.has(filename)) return;
      seen.add(filename);
      // 等 100ms 让写入完成
      await new Promise((r) => setTimeout(r, 100));
      await processImportFile(join(dir, filename)).catch((e) => err(filename, e.message));
    });
    log('就绪，等待新文件...');
  } else if (args[0]) {
    const result = await processImportFile(pathResolve(args[0]));
    log(c.green('完成'), result.processedPath);
  } else {
    console.log('用法:');
    console.log('  node scripts/server/importProcessor.mjs <raw.json>');
    console.log('  node scripts/server/importProcessor.mjs --watch [dir]');
    process.exit(1);
  }
}
