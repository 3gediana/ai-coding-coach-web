// ==UserScript==
// @name         AI Coach 题目推送器
// @namespace    https://github.com/aicc-pusher
// @version      0.1.0
// @description  从校内 OJ / 头歌 educoder 抓题目 → 推送到 AI Coach 项目（http://127.0.0.1:5173）。点击右下角「📤 推送」按钮触发，不自动推。
// @author       AI Coach
// @match        http://10.11.219.21/*
// @match        https://www.educoder.net/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  const COACH_URL = 'http://127.0.0.1:5173/__import';

  // ─────────── 站点检测 ───────────

  /** @returns {'school-oj' | 'educoder' | null} */
  function detectSite() {
    if (location.hostname === '10.11.219.21') return 'school-oj';
    if (location.hostname === 'www.educoder.net') return 'educoder';
    return null;
  }

  /** 当前是否在题目页（非列表页）？ */
  function isProblemPage(site) {
    if (site === 'school-oj') {
      // /#/contest/123 是测验页（包含一道题），列表页是 /#/contests?group=xx
      return location.hash.startsWith('#/contest/') && !location.hash.startsWith('#/contests');
    }
    if (site === 'educoder') {
      // /tasks/xxx/yyy/zzz 是某关卡题目页
      return location.pathname.startsWith('/tasks/') && location.pathname.split('/').length >= 4;
    }
    return false;
  }

  // ─────────── 提取器 ───────────

  /** 把图片 URL fetch 成 base64 (data URI 提取) */
  async function imgToBase64(src) {
    if (src.startsWith('data:')) return src.split(',')[1] || null;
    try {
      const resp = await fetch(src);
      if (!resp.ok) return null;
      const blob = await resp.blob();
      return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
          const result = String(r.result || '');
          resolve(result.split(',')[1] || null);
        };
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('[aicc-pusher] 图片 base64 转换失败', src, e);
      return null;
    }
  }

  async function collectImages(rootEl) {
    if (!rootEl) return [];
    const imgs = [...rootEl.querySelectorAll('img')].filter((i) => i.naturalWidth > 30);
    const result = [];
    for (const img of imgs) {
      const b64 = await imgToBase64(img.src);
      result.push({
        src: img.src,
        alt: img.alt || null,
        base64: b64,
      });
    }
    return result;
  }

  /** 校内 OJ 提取 */
  async function extractSchoolOJ() {
    const main = document.querySelector('main.main-container .el-card__body');
    if (!main) throw new Error('未找到题目主容器（.main-container .el-card__body）');

    const fullText = main.innerText.trim();

    // 标题：第一个 div 含 "【id:xx】【xx分】题名"
    let title = '导入的题目';
    const titleMatch = fullText.match(/【id:[^】]+】【[^】]+】\s*([^\n]+)/);
    if (titleMatch) title = titleMatch[1].trim();

    // 编辑器现有代码（CodeMirror）
    let initialCode = '';
    const cm = document.querySelector('.CodeMirror');
    if (cm && cm.CodeMirror) {
      initialCode = cm.CodeMirror.getValue();
    }

    const images = await collectImages(main);

    return {
      source: 'school-oj',
      url: location.href,
      title,
      rawText: fullText,
      images,
      initialCode,
      language: 'cpp',
      meta: {
        domain: location.hostname,
        contestId: location.hash.match(/#\/contest\/(\d+)/)?.[1],
      },
    };
  }

  /** 头歌 educoder 提取 */
  async function extractEducoder() {
    const leftPanel = document.querySelector('section#task-left-panel .scroll___lsiy3');
    if (!leftPanel) throw new Error('未找到题目左面板（section#task-left-panel）');

    const fullText = leftPanel.innerText.trim();
    const titleEl = document.querySelector('h2.shixun-info');
    let title = titleEl?.innerText?.trim() || document.title;
    // 去除 "实验总用时" 等噪音
    title = title.replace(/实验总用时[：:]\s*[\d:]+/g, '').trim();

    // Monaco 编辑器现有代码
    let initialCode = '';
    if (window.monaco) {
      const editors = window.monaco.editor.getEditors();
      if (editors?.length) initialCode = editors[0].getValue();
    }

    const images = await collectImages(leftPanel);

    return {
      source: 'educoder',
      url: location.href,
      title,
      rawText: fullText,
      images,
      initialCode,
      language: detectEducoderLang(initialCode, fullText),
      meta: {
        domain: location.hostname,
      },
    };
  }

  function detectEducoderLang(code, text) {
    if (/import\s+\w+|def\s+\w+\(|print\(/.test(code) || /Python/i.test(text)) return 'python';
    if (/#include|using\s+namespace|std::/.test(code) || /C\+\+/.test(text)) return 'cpp';
    if (/public\s+class|System\.out/.test(code) || /\bJava\b/.test(text)) return 'java';
    return 'cpp';
  }

  // ─────────── 推送 ───────────

  function pushPayload(payload) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: COACH_URL,
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify(payload),
        timeout: 30_000,
        onload: (r) => {
          if (r.status >= 200 && r.status < 300) {
            try {
              resolve(JSON.parse(r.responseText));
            } catch {
              resolve({ ok: true });
            }
          } else {
            reject(new Error(`HTTP ${r.status}: ${r.responseText?.slice(0, 200)}`));
          }
        },
        onerror: (e) => reject(new Error('网络错误：AI Coach 是否在 5173 端口运行？')),
        ontimeout: () => reject(new Error('超时（30s）')),
      });
    });
  }

  // ─────────── UI ───────────

  function injectStyles() {
    const css = `
    .aicc-push-btn {
      position: fixed; right: 20px; bottom: 20px; z-index: 999999;
      padding: 10px 16px; border-radius: 24px;
      background: linear-gradient(135deg, #ff6b00, #ffaa00);
      color: white; font-size: 13px; font-weight: 600;
      border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,.2);
      font-family: system-ui, sans-serif;
      transition: transform .15s, box-shadow .15s;
      display: flex; align-items: center; gap: 6px;
    }
    .aicc-push-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,.3);
    }
    .aicc-push-btn:disabled {
      opacity: .6; cursor: wait;
    }
    .aicc-push-btn.ok { background: linear-gradient(135deg, #10b981, #059669); }
    .aicc-push-btn.err { background: linear-gradient(135deg, #ef4444, #dc2626); }
    .aicc-push-toast {
      position: fixed; right: 20px; bottom: 80px; z-index: 999999;
      max-width: 360px; padding: 10px 14px;
      background: #1a1a1a; color: #e0e0e0;
      border-radius: 8px; font-size: 12px;
      font-family: system-ui, sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.3);
      animation: aicc-toast-in .25s ease-out;
    }
    @keyframes aicc-toast-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function showToast(text, type = 'info') {
    const t = document.createElement('div');
    t.className = 'aicc-push-toast';
    if (type === 'err') t.style.borderLeft = '3px solid #ef4444';
    else if (type === 'ok') t.style.borderLeft = '3px solid #10b981';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  let btn = null;
  function ensureButton(site) {
    if (btn) return btn;
    btn = document.createElement('button');
    btn.className = 'aicc-push-btn';
    btn.innerHTML = `📤 推送到 AI Coach`;
    btn.title = `从 ${site === 'school-oj' ? '校内 OJ' : '头歌'} 抓取当前题目并推送到 AI Coach (5173)`;

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.innerHTML = '⏳ 抓取中...';
      btn.classList.remove('ok', 'err');
      try {
        const payload = site === 'school-oj' ? await extractSchoolOJ() : await extractEducoder();
        btn.innerHTML = `📤 推送中... (${payload.images.length} 图)`;
        const resp = await pushPayload(payload);
        btn.innerHTML = '✅ 已推送';
        btn.classList.add('ok');
        showToast(
          `已推送：${payload.title.slice(0, 30)}\n${payload.images.length} 张图${payload.images.length ? '（sam 识别中）' : ''}`,
          'ok',
        );
        setTimeout(() => {
          btn.innerHTML = '📤 推送到 AI Coach';
          btn.classList.remove('ok');
          btn.disabled = false;
        }, 3000);
      } catch (err) {
        console.error('[aicc-pusher]', err);
        btn.innerHTML = '❌ 推送失败';
        btn.classList.add('err');
        showToast(`推送失败：${err.message}\n确认 AI Coach 在 5173 端口运行`, 'err');
        setTimeout(() => {
          btn.innerHTML = '📤 推送到 AI Coach';
          btn.classList.remove('err');
          btn.disabled = false;
        }, 4500);
      }
    });
    document.body.appendChild(btn);
    return btn;
  }

  function removeButton() {
    if (btn) {
      btn.remove();
      btn = null;
    }
  }

  // ─────────── 路由变化监听（SPA） ───────────

  function checkAndUpdate() {
    const site = detectSite();
    if (!site) {
      removeButton();
      return;
    }
    if (isProblemPage(site)) {
      ensureButton(site);
    } else {
      removeButton();
    }
  }

  function init() {
    injectStyles();
    checkAndUpdate();

    // SPA 路由 hook
    const origPushState = history.pushState;
    const origReplaceState = history.replaceState;
    history.pushState = function () {
      const r = origPushState.apply(this, arguments);
      setTimeout(checkAndUpdate, 100);
      return r;
    };
    history.replaceState = function () {
      const r = origReplaceState.apply(this, arguments);
      setTimeout(checkAndUpdate, 100);
      return r;
    };
    window.addEventListener('popstate', () => setTimeout(checkAndUpdate, 100));
    window.addEventListener('hashchange', () => setTimeout(checkAndUpdate, 100));

    console.log('[aicc-pusher] 已加载，进入题目页右下角会出现「📤 推送」按钮');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
