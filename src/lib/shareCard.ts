/**
 * 生成"完成题目"分享卡片：
 *   - Canvas 2D 直绘，无第三方依赖
 *   - 1080×1350 适合朋友圈竖图
 *   - 渐变背景 + 题目名 + verdict chip + 复杂度 + 一句话评语 + 日期 + 水印
 *
 * 用法：
 *   import { generateShareCard, downloadShareCard, copyShareCardToClipboard } from '../lib/shareCard';
 *   const blob = await generateShareCard({...});
 *   await copyShareCardToClipboard(blob);
 */

export interface ShareCardData {
  title: string;
  language: string;
  verdict?: string; // 'AC' | 'WA' | ...
  complexity?: string;
  comment?: string;
  date?: number;
}

const W = 1080;
const H = 1350;

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 自动换行 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    const test = cur + ch;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = ch;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function generateShareCard(d: ShareCardData): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');

  // 背景：从深紫到深青的对角线渐变
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#1a1530');
  grad.addColorStop(0.5, '#1f2330');
  grad.addColorStop(1, '#0f2e2c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // 装饰：右上角光晕
  const halo = ctx.createRadialGradient(W - 100, 100, 0, W - 100, 100, 500);
  halo.addColorStop(0, 'rgba(124,131,255,0.4)');
  halo.addColorStop(1, 'rgba(124,131,255,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, W, H);

  // 装饰：左下角光晕
  const halo2 = ctx.createRadialGradient(120, H - 100, 0, 120, H - 100, 480);
  halo2.addColorStop(0, 'rgba(45,212,191,0.3)');
  halo2.addColorStop(1, 'rgba(45,212,191,0)');
  ctx.fillStyle = halo2;
  ctx.fillRect(0, 0, W, H);

  // ── 顶部：标识 + 日期 ──
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '28px ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('✦  AI Coding Coach', 80, 80);

  const dateStr = new Date(d.date ?? Date.now()).toLocaleDateString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'short',
  });
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 80, 80);
  ctx.textAlign = 'left';

  // ── 中部：题目名（大字号） ──
  ctx.fillStyle = '#cdd3df';
  ctx.font = '600 32px ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('我刚刷完一题', 80, 200);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 76px ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif';
  const titleLines = wrapText(ctx, d.title, W - 160);
  titleLines.slice(0, 3).forEach((line, i) => {
    ctx.fillText(line, 80, 270 + i * 90);
  });
  const titleEndY = 270 + Math.min(titleLines.length, 3) * 90;

  // ── chips：verdict + 语言 + 复杂度 ──
  const chipY = titleEndY + 40;
  let cx = 80;
  const chipPad = 22;
  const chipH = 56;
  ctx.font = '600 26px ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif';

  // verdict chip
  if (d.verdict) {
    const isAC = d.verdict === 'AC';
    const bg = isAC ? 'rgba(45,212,191,0.18)' : 'rgba(255,193,7,0.18)';
    const border = isAC ? 'rgba(45,212,191,0.6)' : 'rgba(255,193,7,0.6)';
    const text = isAC ? '#2dd4bf' : '#ffc107';
    const label = isAC ? '✓ AC' : d.verdict;
    const w = ctx.measureText(label).width + chipPad * 2;
    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, cx, chipY, w, chipH, 28);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = text;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + chipPad, chipY + chipH / 2);
    cx += w + 14;
  }
  // 语言 chip
  {
    const label = d.language;
    const w = ctx.measureText(label).width + chipPad * 2;
    ctx.fillStyle = 'rgba(124,131,255,0.18)';
    ctx.strokeStyle = 'rgba(124,131,255,0.6)';
    ctx.lineWidth = 2;
    drawRoundedRect(ctx, cx, chipY, w, chipH, 28);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#a8aeff';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx + chipPad, chipY + chipH / 2);
    cx += w + 14;
  }
  // 复杂度 chip
  if (d.complexity) {
    const label = d.complexity;
    const w = ctx.measureText(label).width + chipPad * 2;
    if (cx + w < W - 80) {
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, cx, chipY, w, chipH, 28);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#cdd3df';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cx + chipPad, chipY + chipH / 2);
    }
  }
  ctx.textBaseline = 'top';

  // ── AI 一句话评语 ──
  if (d.comment) {
    const commentY = chipY + chipH + 80;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1.5;
    drawRoundedRect(ctx, 80, commentY, W - 160, 380, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = 'rgba(124,131,255,0.9)';
    ctx.font = '600 24px ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText('AI 教练点评', 110, commentY + 30);

    ctx.fillStyle = '#cdd3df';
    ctx.font = '32px ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif';
    const commentLines = wrapText(ctx, d.comment.trim(), W - 220);
    commentLines.slice(0, 6).forEach((line, i) => {
      ctx.fillText(line, 110, commentY + 80 + i * 48);
    });
  }

  // ── 底部：水印 ──
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '24px ui-sans-serif, "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('生于 AI Coding Coach · 用 AI 当算法教练', W / 2, H - 80);
  ctx.textAlign = 'left';

  // → Blob
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('toBlob failed'));
    }, 'image/png', 0.95);
  });
}

export async function downloadShareCard(d: ShareCardData) {
  const blob = await generateShareCard(d);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aicc-${d.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)}-${Date.now()}.png`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

/** 复制到剪贴板（用户可直接 Ctrl+V 粘到微信/朋友圈） */
export async function copyShareCardToClipboard(d: ShareCardData): Promise<boolean> {
  try {
    const blob = await generateShareCard(d);
    if (!('clipboard' in navigator) || !('write' in navigator.clipboard)) return false;
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': blob }),
    ]);
    return true;
  } catch {
    return false;
  }
}
