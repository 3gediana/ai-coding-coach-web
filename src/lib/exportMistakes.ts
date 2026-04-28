/**
 * 错题本导出工具：
 *   - exportMistakesToMarkdown: 单文件 Markdown，可直接发到 Notion / 飞书 / GitHub
 *   - exportMistakesToAnki:     生成 .csv（Anki 标准导入格式：正面 \t 反面 \t 标签）
 *
 * 设计原则：
 *   - 不依赖任何第三方库，纯字符串拼接（Anki .apkg 需要 SQLite 处理太重，CSV 已足够）
 *   - Anki CSV 用 Tab 分隔（避免逗号/英文引号干扰），UTF-8 BOM 防 Excel 乱码
 */
import type { Mistake } from '../core/types';

function ts2date(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 触发浏览器下载 */
function triggerDownload(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

// ─────────────────────────────────────────────────────────────
// Markdown 导出
// ─────────────────────────────────────────────────────────────

export function buildMarkdown(mistakes: Mistake[]): string {
  const sorted = [...mistakes].sort((a, b) => b.createdAt - a.createdAt);
  const total = sorted.length;
  const byCategory = new Map<string, number>();
  for (const m of sorted) byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);

  let md = `# 错题本（${total} 题）\n\n`;
  md += `> 导出时间：${new Date().toLocaleString()}\n\n`;
  if (byCategory.size > 0) {
    md += `## 错题分布\n\n`;
    for (const [c, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      md += `- **${c}** × ${n}\n`;
    }
    md += `\n`;
  }
  md += `---\n\n`;

  sorted.forEach((m, i) => {
    md += `## ${i + 1}. ${m.problemTitle}\n\n`;
    md += `- **创建于**：${ts2date(m.createdAt)}\n`;
    md += `- **分类**：${m.category}\n`;
    md += `- **语言**：${m.language}\n`;
    if (m.verdict) md += `- **评判**：${m.verdict}\n`;
    if (m.knowledgePoints.length) md += `- **知识点**：${m.knowledgePoints.map(k => '`' + k + '`').join(' ')}\n`;
    if (m.reviewCount > 0) md += `- **复习次数**：${m.reviewCount}\n`;
    md += `\n### 错因\n\n${m.rootCause}\n\n`;
    if (m.userNote) md += `### 现象\n\n${m.userNote}\n\n`;
    md += `### 错误代码\n\n\`\`\`${m.language}\n${m.wrongCode}\n\`\`\`\n\n`;
    if (m.correctSketch) md += `### 正确思路\n\n${m.correctSketch}\n\n`;
    if (m.correctCode) md += `### 修正后\n\n\`\`\`${m.language}\n${m.correctCode}\n\`\`\`\n\n`;
    if (m.reviewTips.length) {
      md += `### 复习要点\n\n`;
      for (const t of m.reviewTips) md += `- ${t}\n`;
      md += `\n`;
    }
    md += `---\n\n`;
  });

  return md;
}

export function exportMistakesToMarkdown(mistakes: Mistake[]) {
  const content = buildMarkdown(mistakes);
  const filename = `错题本-${ts2date(Date.now())}.md`;
  triggerDownload(filename, content, 'text/markdown;charset=utf-8');
}

// ─────────────────────────────────────────────────────────────
// Anki CSV 导出
// ─────────────────────────────────────────────────────────────
// Anki 导入格式：每行一张卡，Tab 分隔字段，第一列正面，第二列反面，第三列 tags（空格分隔）
// 在 Anki 桌面：文件 → 导入 → 选 .csv → 字段分隔符选 Tab，勾选「字段中允许 HTML」

/** 把 Mistake 转成 Anki 卡片：正面 = 题目 + 错误代码；反面 = 错因 + 正确思路 + reviewTips */
export function buildAnkiCsv(mistakes: Mistake[]): string {
  // Tab 是 Anki 默认分隔；任何字段里出现 \t 或 \n 都需要用 HTML <br> 替换
  const escape = (s: string) =>
    s.replace(/\t/g, '    ').replace(/\r/g, '').replace(/\n/g, '<br>');

  const lines: string[] = [];
  // 头部注释（Anki 会忽略以 # 开头的行）
  lines.push('#separator:tab');
  lines.push('#html:true');
  lines.push('#tags column:3');

  for (const m of mistakes) {
    const front = [
      `<b>${escape(m.problemTitle)}</b>`,
      `<div style="color:#888;font-size:0.85em">${escape(m.category)} · ${m.language}</div>`,
      m.userNote ? `<div style="margin-top:6px"><i>现象：${escape(m.userNote)}</i></div>` : '',
      `<pre style="background:#1f2330;color:#cdd3df;padding:8px;border-radius:6px;font-size:0.9em;overflow:auto"><code>${escape(m.wrongCode)}</code></pre>`,
      `<div style="margin-top:8px;color:#888">这段代码错在哪？</div>`,
    ].filter(Boolean).join('');

    const back = [
      `<div><b>错因：</b>${escape(m.rootCause)}</div>`,
      m.correctSketch ? `<div style="margin-top:6px"><b>正确思路：</b>${escape(m.correctSketch)}</div>` : '',
      m.correctCode
        ? `<pre style="background:#16321f;color:#a7e8c4;padding:8px;border-radius:6px;font-size:0.9em;overflow:auto;margin-top:6px"><code>${escape(m.correctCode)}</code></pre>`
        : '',
      m.reviewTips.length
        ? `<div style="margin-top:6px"><b>要点：</b><ul style="margin:4px 0 0 16px">${m.reviewTips.map((t) => `<li>${escape(t)}</li>`).join('')}</ul></div>`
        : '',
    ].filter(Boolean).join('');

    const tags = [
      'aicc',
      m.category.replace(/\s+/g, '_'),
      m.language,
      ...(m.knowledgePoints ?? []).slice(0, 5).map((k) => k.replace(/\s+/g, '_')),
    ].join(' ');

    lines.push(`${front}\t${back}\t${tags}`);
  }
  return '\uFEFF' + lines.join('\n');
}

export function exportMistakesToAnki(mistakes: Mistake[]) {
  const content = buildAnkiCsv(mistakes);
  const filename = `错题本-Anki-${ts2date(Date.now())}.csv`;
  triggerDownload(filename, content, 'text/csv;charset=utf-8');
}
