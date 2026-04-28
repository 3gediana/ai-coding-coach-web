// ==UserScript==
// @name         AI Coach 通用网页结构探针
// @namespace    https://github.com/aicc-probe
// @version      0.1.1
// @description  在任意网页上抓取页面结构（题面 / 图片 / 代码块 / 编辑器位置），导出 JSON / HTML 给 AI Coach 项目，用于设计平台专用解析器
// @author       AI Coach
// @match        *://*/*
// @match        http://10.11.219.21/*
// @grant        GM_setClipboard
// @grant        GM_download
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // 防止 iframe 重复注入
  if (window.top !== window.self) return;

  // ─────────────────── 工具函数 ───────────────────

  const $ = (s, root = document) => root.querySelector(s);

  /** 截断字符串 */
  const truncate = (s, n = 200) => {
    if (!s) return null;
    s = String(s).replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  };

  /** 元素尺寸 */
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { w: r.width | 0, h: r.height | 0, x: r.x | 0, y: r.y | 0 };
  };

  /** 元素是否"明显可见"（>50x30 + 不为 display:none） */
  const isVisible = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 30) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0;
  };

  /** 计算 css 路径（短路径 + 跳过 css-xxx 自动生成 class） */
  const cssPath = (el) => {
    if (!el || el === document.body) return 'body';
    const path = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.body && depth < 6) {
      let s = cur.tagName?.toLowerCase() || '';
      if (cur.id) {
        s += '#' + cur.id;
        path.unshift(s);
        break; // id 唯一，到这就停
      } else if (typeof cur.className === 'string' && cur.className) {
        const cls = cur.className
          .split(/\s+/)
          .filter((c) => c && !c.startsWith('css-') && !/^_[a-zA-Z0-9]+_/.test(c) && c.length < 30)
          .slice(0, 2);
        if (cls.length) s += '.' + cls.join('.');
      }
      // 加 nth-of-type 提高唯一性（仅当父节点有多个同类）
      if (cur.parentElement) {
        const sibs = [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName);
        if (sibs.length > 1) {
          const idx = sibs.indexOf(cur) + 1;
          s += `:nth-of-type(${idx})`;
        }
      }
      path.unshift(s);
      cur = cur.parentElement;
      depth++;
    }
    return path.join(' > ');
  };

  /** 文本内容长度（剔除空白） */
  const textLen = (el) => (el?.innerText || '').replace(/\s+/g, ' ').trim().length;

  // ─────────────────── 探针主函数 ───────────────────

  function probe() {
    // 1. 标题候选（h1-h3）
    const titles = [...document.querySelectorAll('h1, h2, h3')]
      .filter(isVisible)
      .slice(0, 8)
      .map((el) => ({
        tag: el.tagName,
        path: cssPath(el),
        text: truncate(el.innerText, 100),
      }));

    // 2. 大文本容器（候选题面）
    const containers = [...document.querySelectorAll('div, section, article, main, aside')]
      .filter(isVisible)
      .map((el) => {
        const tl = textLen(el);
        return tl > 100 && el.children.length > 0 ? { el, tl } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.tl - a.tl)
      .slice(0, 10)
      .map(({ el, tl }) => ({
        path: cssPath(el),
        cls: typeof el.className === 'string' ? truncate(el.className, 60) : '',
        size: rect(el),
        textLen: tl,
        childCount: el.children.length,
        preview: truncate(el.innerText, 120),
      }));

    // 3. 图片（所有可见）
    const images = [...document.querySelectorAll('img')]
      .filter(isVisible)
      .map((img) => ({
        src: img.src,
        alt: img.alt || null,
        natural: { w: img.naturalWidth, h: img.naturalHeight },
        display: rect(img),
        parentPath: cssPath(img.parentElement),
      }));

    // 4. 代码块（pre / code / Monaco / CodeMirror / Ace）
    const codeBlocks = [
      ...document.querySelectorAll('pre, code'),
    ]
      .filter(isVisible)
      .filter((el) => {
        // 排除嵌套的 code in pre（重复）
        if (el.tagName === 'CODE' && el.parentElement?.tagName === 'PRE') return false;
        return textLen(el) > 5;
      })
      .slice(0, 15)
      .map((el) => ({
        tag: el.tagName,
        path: cssPath(el),
        cls: typeof el.className === 'string' ? truncate(el.className, 60) : '',
        size: rect(el),
        text: truncate(el.innerText, 200),
      }));

    // 编辑器
    const editors = [
      ...document.querySelectorAll(
        '.CodeMirror, .monaco-editor, .ace_editor, [class*="editor-container"], [data-editor], textarea[class*="code"]',
      ),
    ]
      .filter(isVisible)
      .slice(0, 5)
      .map((el) => {
        let kind = 'unknown';
        if (el.classList.contains('CodeMirror')) kind = 'CodeMirror';
        else if (el.classList.contains('monaco-editor')) kind = 'Monaco';
        else if (el.classList.contains('ace_editor')) kind = 'Ace';
        else if (el.tagName === 'TEXTAREA') kind = 'textarea';
        return {
          kind,
          path: cssPath(el),
          cls: typeof el.className === 'string' ? truncate(el.className, 60) : '',
          size: rect(el),
        };
      });

    // 5. tabs（题目页常见 tab 切换）
    const tabs = [
      ...document.querySelectorAll('[role="tab"], .tab, [class*="tab-item"], [class*="tabs__"]'),
    ]
      .filter(isVisible)
      .slice(0, 12)
      .map((el) => ({
        path: cssPath(el),
        text: truncate(el.innerText, 30),
        active: el.getAttribute('aria-selected') === 'true' || el.classList.contains('active'),
      }));

    // 6. 提交 / 评测按钮
    const buttons = [...document.querySelectorAll('button, [role="button"], a.btn, [class*="btn-"]')]
      .filter(isVisible)
      .map((el) => ({ path: cssPath(el), text: truncate(el.innerText || el.value, 30) }))
      .filter((b) => {
        const t = b.text || '';
        return /(提交|评测|运行|测试|submit|run|judge|查看|开始)/i.test(t);
      })
      .slice(0, 10);

    // 7. iframe（很多 OJ 用 iframe 嵌题面）
    const iframes = [...document.querySelectorAll('iframe')]
      .filter(isVisible)
      .map((el) => ({
        path: cssPath(el),
        src: el.src,
        size: rect(el),
      }));

    // 8. SPA 框架检测
    const frameworks = [];
    if (window.React || document.querySelector('[data-reactroot]')) frameworks.push('React');
    if (window.Vue || document.querySelector('[data-v-app]')) frameworks.push('Vue');
    if (window.ng || document.querySelector('[ng-version]')) frameworks.push('Angular');

    return {
      url: location.href,
      title: document.title,
      domain: location.hostname,
      timestamp: new Date().toISOString(),
      frameworks,
      titles,
      containers_top10: containers,
      images,
      code_blocks: codeBlocks,
      editors,
      tabs,
      buttons_action: buttons,
      iframes,
      summary: {
        titleCount: titles.length,
        containerCount: containers.length,
        imageCount: images.length,
        codeBlockCount: codeBlocks.length,
        editorCount: editors.length,
        tabCount: tabs.length,
      },
    };
  }

  // ─────────────────── 高亮元素（hover modal 项时闪烁） ───────────────────

  let highlightEl = null;
  function highlight(path) {
    try {
      // path 可能含 :nth-of-type，querySelector 支持
      const el = document.querySelector(path);
      if (!el) return;
      if (highlightEl === el) {
        clearHighlight();
        return;
      }
      clearHighlight();
      highlightEl = el;
      el.dataset._aiccOldOutline = el.style.outline || '';
      el.dataset._aiccOldOffset = el.style.outlineOffset || '';
      el.style.outline = '3px solid #ff6b00';
      el.style.outlineOffset = '2px';
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
      console.warn('[aicc-probe] 高亮失败', e);
    }
  }
  function clearHighlight() {
    if (highlightEl) {
      highlightEl.style.outline = highlightEl.dataset._aiccOldOutline || '';
      highlightEl.style.outlineOffset = highlightEl.dataset._aiccOldOffset || '';
      delete highlightEl.dataset._aiccOldOutline;
      delete highlightEl.dataset._aiccOldOffset;
      highlightEl = null;
    }
  }

  // ─────────────────── UI ───────────────────

  function injectStyles() {
    const css = `
    .aicc-probe-fab {
      position: fixed; right: 20px; bottom: 20px; z-index: 999999;
      width: 48px; height: 48px; border-radius: 50%;
      background: linear-gradient(135deg, #ff6b00, #ffaa00);
      color: white; font-size: 20px; font-weight: bold;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      border: none; transition: transform .2s;
      font-family: system-ui, sans-serif;
    }
    .aicc-probe-fab:hover { transform: scale(1.1); }

    .aicc-probe-modal-bg {
      position: fixed; inset: 0; background: rgba(0,0,0,.5);
      z-index: 999998; backdrop-filter: blur(4px);
    }
    .aicc-probe-modal {
      position: fixed; top: 5%; right: 20px; bottom: 5%; width: 600px; max-width: 95vw;
      z-index: 999999; background: #1a1a1a; color: #e0e0e0;
      border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.6);
      display: flex; flex-direction: column; overflow: hidden;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .aicc-probe-header {
      padding: 12px 16px; background: #0a0a0a; border-bottom: 1px solid #333;
      display: flex; align-items: center; gap: 8px; flex-shrink: 0;
    }
    .aicc-probe-header h3 { margin: 0; font-size: 14px; flex: 1; }
    .aicc-probe-header button {
      padding: 4px 10px; background: #2a2a2a; color: #e0e0e0;
      border: 1px solid #444; border-radius: 6px; cursor: pointer;
      font-size: 12px; transition: background .2s;
    }
    .aicc-probe-header button:hover { background: #3a3a3a; }
    .aicc-probe-header button.primary {
      background: #ff6b00; border-color: #ff6b00; color: white;
    }
    .aicc-probe-header button.primary:hover { background: #ff8533; }
    .aicc-probe-body {
      flex: 1; overflow: auto; padding: 12px 16px;
      font-family: 'Consolas', 'Monaco', monospace; font-size: 12px;
    }
    .aicc-probe-body pre {
      margin: 0; white-space: pre-wrap; word-break: break-all;
      color: #e0e0e0; line-height: 1.5;
    }
    .aicc-probe-section {
      margin-bottom: 14px; padding: 10px; background: #0f0f0f;
      border-radius: 6px; border: 1px solid #2a2a2a;
    }
    .aicc-probe-section h4 {
      margin: 0 0 8px; font-size: 12px; color: #ffaa00;
      font-family: system-ui, sans-serif;
      text-transform: uppercase; letter-spacing: .5px;
    }
    .aicc-probe-item {
      padding: 6px 8px; margin: 4px 0; background: #1a1a1a;
      border-radius: 4px; cursor: pointer;
      border-left: 2px solid transparent;
      transition: background .15s;
    }
    .aicc-probe-item:hover { background: #2a2a2a; border-left-color: #ff6b00; }
    .aicc-probe-item .path { color: #6ab; font-size: 10px; }
    .aicc-probe-item .preview { color: #ddd; margin-top: 4px; }
    .aicc-probe-item .meta { color: #888; font-size: 10px; margin-top: 2px; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  /** 当前显示的 modal（最多一个，新建会先关旧的） */
  let currentClose = null;

  function showModal(data) {
    // 旧 modal 先干掉，避免叠加
    if (currentClose) currentClose();

    const bg = document.createElement('div');
    bg.className = 'aicc-probe-modal-bg';

    const modal = document.createElement('div');
    modal.className = 'aicc-probe-modal';

    const header = document.createElement('div');
    header.className = 'aicc-probe-header';
    header.innerHTML = `
      <h3>🔍 AI Coach 探针 · ${data.summary.containerCount} 容器 / ${data.summary.imageCount} 图 / ${data.summary.codeBlockCount} 代码 / ${data.summary.editorCount} 编辑器</h3>
      <button type="button" class="primary" data-act="copy-json">📋 复制 JSON</button>
      <button type="button" data-act="copy-html">📄 复制 HTML</button>
      <button type="button" data-act="download">⬇ 下载</button>
      <button type="button" data-act="close" title="关闭 (Esc)">✕</button>
    `;

    const body = document.createElement('div');
    body.className = 'aicc-probe-body';
    body.innerHTML = renderBody(data);

    modal.appendChild(header);
    modal.appendChild(body);

    function close() {
      try { clearHighlight(); } catch {}
      try { bg.remove(); } catch {}
      try { modal.remove(); } catch {}
      document.removeEventListener('keydown', onKey, true);
      currentClose = null;
    }
    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        ev.preventDefault();
        close();
      }
    }
    currentClose = close;
    document.addEventListener('keydown', onKey, true);

    // 点黑色蒙版关闭
    bg.addEventListener('click', close);

    // 用 closest 兜底：哪怕点到按钮内的 emoji 文字节点也能找到 button[data-act]
    header.addEventListener('click', (e) => {
      const btn = e.target.closest && e.target.closest('button[data-act]');
      if (!btn) return;
      e.stopPropagation();
      const act = btn.getAttribute('data-act');
      if (act === 'copy-json') {
        const json = JSON.stringify(data, null, 2);
        copyText(json);
        flash(btn, '已复制 JSON');
      } else if (act === 'copy-html') {
        copyText(document.documentElement.outerHTML);
        flash(btn, '已复制 HTML');
      } else if (act === 'download') {
        downloadFile(`aicc-probe-${location.hostname}-${Date.now()}.json`, JSON.stringify(data, null, 2));
        downloadFile(`aicc-probe-${location.hostname}-${Date.now()}.html`, document.documentElement.outerHTML);
        flash(btn, '已触发下载');
      } else if (act === 'close') {
        close();
      }
    });

    body.addEventListener('click', (e) => {
      const item = e.target.closest('.aicc-probe-item');
      if (item) {
        const path = item.getAttribute('data-path');
        if (path) highlight(path);
      }
    });

    document.body.appendChild(bg);
    document.body.appendChild(modal);
  }

  function renderBody(data) {
    const parts = [];

    parts.push(section('基本信息', `
      <div class="aicc-probe-item">
        <div><strong>${escapeHtml(data.title)}</strong></div>
        <div class="path">${escapeHtml(data.url)}</div>
        <div class="meta">框架: ${data.frameworks.join(', ') || '未检测到'} · ${data.timestamp}</div>
      </div>
    `));

    if (data.titles.length) {
      parts.push(section('标题候选', data.titles.map((t) => `
        <div class="aicc-probe-item" data-path="${escapeAttr(t.path)}">
          <div><strong>${t.tag}</strong> ${escapeHtml(t.text)}</div>
          <div class="path">${escapeHtml(t.path)}</div>
        </div>
      `).join('')));
    }

    parts.push(section('文本容器（按文本量倒序 top 10，可能是题面）', data.containers_top10.map((c, i) => `
      <div class="aicc-probe-item" data-path="${escapeAttr(c.path)}">
        <div class="path">#${i + 1} ${escapeHtml(c.path)}</div>
        <div class="preview">${escapeHtml(c.preview)}</div>
        <div class="meta">${c.size.w}×${c.size.h} · ${c.textLen} 字 · ${c.childCount} 子节点 · class: ${escapeHtml(c.cls)}</div>
      </div>
    `).join('')));

    if (data.images.length) {
      parts.push(section(`图片 ${data.images.length} 张`, data.images.map((img) => `
        <div class="aicc-probe-item" data-path="${escapeAttr(img.parentPath)}">
          <div><img src="${escapeAttr(img.src)}" style="max-width:100px; max-height:60px;"></div>
          <div class="meta">${img.natural.w}×${img.natural.h} (显示 ${img.display.w}×${img.display.h}) · alt: ${escapeHtml(img.alt || '')}</div>
          <div class="path">${escapeHtml(img.src.length > 80 ? img.src.slice(0, 80) + '…' : img.src)}</div>
        </div>
      `).join('')));
    }

    if (data.code_blocks.length) {
      parts.push(section(`代码块 ${data.code_blocks.length} 块`, data.code_blocks.map((c) => `
        <div class="aicc-probe-item" data-path="${escapeAttr(c.path)}">
          <div class="path">${c.tag} · ${escapeHtml(c.path)}</div>
          <div class="preview">${escapeHtml(c.text)}</div>
          <div class="meta">${c.size.w}×${c.size.h} · class: ${escapeHtml(c.cls)}</div>
        </div>
      `).join('')));
    }

    if (data.editors.length) {
      parts.push(section(`代码编辑器 ${data.editors.length} 个`, data.editors.map((e) => `
        <div class="aicc-probe-item" data-path="${escapeAttr(e.path)}">
          <div><strong>${e.kind}</strong></div>
          <div class="path">${escapeHtml(e.path)}</div>
          <div class="meta">${e.size.w}×${e.size.h} · class: ${escapeHtml(e.cls)}</div>
        </div>
      `).join('')));
    }

    if (data.tabs.length) {
      parts.push(section(`Tabs ${data.tabs.length}`, data.tabs.map((t) => `
        <div class="aicc-probe-item" data-path="${escapeAttr(t.path)}">
          <div>${t.active ? '★ ' : ''}${escapeHtml(t.text)}</div>
          <div class="path">${escapeHtml(t.path)}</div>
        </div>
      `).join('')));
    }

    if (data.buttons_action.length) {
      parts.push(section(`操作按钮 ${data.buttons_action.length}`, data.buttons_action.map((b) => `
        <div class="aicc-probe-item" data-path="${escapeAttr(b.path)}">
          <div><strong>${escapeHtml(b.text)}</strong></div>
          <div class="path">${escapeHtml(b.path)}</div>
        </div>
      `).join('')));
    }

    if (data.iframes.length) {
      parts.push(section(`iframes ${data.iframes.length}`, data.iframes.map((f) => `
        <div class="aicc-probe-item" data-path="${escapeAttr(f.path)}">
          <div class="path">${escapeHtml(f.src)}</div>
          <div class="meta">${f.size.w}×${f.size.h}</div>
        </div>
      `).join('')));
    }

    return parts.join('');
  }

  function section(title, html) {
    return `<div class="aicc-probe-section"><h4>${title}</h4>${html}</div>`;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }
  const escapeAttr = escapeHtml;

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text);
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
  }

  function downloadFile(name, text) {
    const blob = new Blob([text], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  function flash(btn, msg) {
    const old = btn.textContent;
    btn.textContent = msg;
    setTimeout(() => { btn.textContent = old; }, 1500);
  }

  // ─────────────────── 入口 ───────────────────

  function init() {
    injectStyles();
    const fab = document.createElement('button');
    fab.className = 'aicc-probe-fab';
    fab.textContent = '🔍';
    fab.title = 'AI Coach 平台探针 · 点击抓取页面结构';
    fab.onclick = () => {
      try {
        const data = probe();
        showModal(data);
      } catch (e) {
        console.error('[aicc-probe]', e);
        alert('探针失败：' + e.message);
      }
    };
    document.body.appendChild(fab);
    console.log('[aicc-probe] 已加载，点击右下角 🔍 抓取');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
