// ==UserScript==
// @name         AI Coach 题目推送器
// @namespace    https://github.com/aicc-pusher
// @version      0.2.6
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
    // mainContainer = main.main-container (整个题目区域，含样例/编辑器多个 el-card)
    const mainContainer = document.querySelector('main.main-container');
    if (!mainContainer) throw new Error('未找到题目区域（main.main-container）');
    // 题目描述卡片（含 title / 题面 / 代码块）
    const main = mainContainer.querySelector('.el-card__body') || mainContainer;
    if (!main) throw new Error('未找到题目卡片（.el-card__body）');

    const fullText = main.innerText.trim();

    // 标题：第一个 div 含 "【id:xx】【xx分】题名"
    let title = '导入的题目';
    let problemId = '';
    const headerMatch = fullText.match(/【id:(\d+)】【[^】]+】\s*([^\n]+)/);
    if (headerMatch) {
      problemId = headerMatch[1];
      title = headerMatch[2].trim();
    }

    // 编辑器现有代码（CodeMirror）— 多种访问方式兜底
    let initialCode = '';
    const cmEls = document.querySelectorAll('.CodeMirror');
    for (const cm of cmEls) {
      // element 上的 CodeMirror 实例（v5 风格）
      if (cm.CodeMirror?.getValue) {
        initialCode = cm.CodeMirror.getValue();
        if (initialCode) break;
      }
    }
    // 兜底：抓 textarea 里的内容
    if (!initialCode) {
      const ta = document.querySelector('.vue-codemirror-wrap textarea');
      if (ta?.value) initialCode = ta.value;
    }
    // 再兜底：抓渲染出的 .CodeMirror-line（高亮过的代码行）
    if (!initialCode) {
      const lines = document.querySelectorAll('.CodeMirror-code .CodeMirror-line');
      if (lines.length > 0) {
        initialCode = [...lines].map((l) => l.innerText).join('\n');
      }
    }

    const images = await collectImages(main);

    // 把题面里的 <pre.language-*> 单独抽出来包成 markdown ```
    const codeBlocks = [...main.querySelectorAll('pre[class*="language-"]')].map((pre) => {
      const langMatch = pre.className.match(/language-(\w+)/);
      const lang = langMatch ? langMatch[1] : '';
      return { lang, text: pre.innerText.trim() };
    });

    // 校内 OJ 用第二张 el-card 显示样例 + 编辑器
    // 第一张卡 = 题面，第二张卡 = 样例 + 编辑器
    const sampleTabs = harvestSchoolOJSamplesByText(mainContainer);

    // 诊断：保留各卡内容快照
    const allCards = [...mainContainer.querySelectorAll('.el-card__body')];
    const schoolOJDebug = {
      elCardCount: allCards.length,
      elCardTexts: allCards.map((c, i) => ({
        i,
        len: c.innerText.length,
        head: c.innerText.slice(0, 100).replace(/\n/g, '|'),
        tail: c.innerText.slice(-100).replace(/\n/g, '|'),
      })),
      preList: [...mainContainer.querySelectorAll('pre')].map((e) => ({
        cls: e.className.slice(0, 60),
        text: e.innerText.slice(0, 80),
      })),
    };

    // url 加题号，避免同一 contest 多道题被去重覆盖
    const url = problemId ? `${location.href}#problem-${problemId}` : location.href;

    // 构造结构化 markdown rawText（把 pre 包成 ``` 代码块 + 样例分块列出）
    const markdown = buildSchoolOJMarkdown({
      title,
      problemId,
      fullText,
      codeBlocks,
      sampleTabs,
    });

    return {
      source: 'school-oj',
      url,
      title,
      rawText: markdown,
      images,
      initialCode,
      language: 'cpp',
      meta: {
        domain: location.hostname,
        contestId: location.hash.match(/#\/contest\/(\d+)/)?.[1],
        problemId,
        rawInnerText: fullText,
        codeBlocks,
        sampleTabs,
        schoolOJDebug,
      },
    };
  }

  /**
   * 校内 OJ 样例 (基于 DOM 结构 + 文本规则):
   * 第二张 el-card 里有 div 含「输入样例N」/「输出样例N」当 header，紧跟 pre/div 是数据
   * 找所有「输入样例N」「输出样例N」label 元素 → 找最近兄弟/父级里的 pre 取数据
   */
  function harvestSchoolOJSamplesByText(mainContainer) {
    const samples = [];
    // 找所有含「输入样例N」/「输出样例N」字眼的元素（精确到 leaf 节点）
    const all = [...mainContainer.querySelectorAll('div, span, h3, h4, label, p')];
    const headerEls = all.filter((el) => {
      const t = el.innerText?.trim() || '';
      // 不能太长（label 应短），不能含 pre 子元素（不是 leaf）
      return t.length < 50 && /^(输入|输出)样例\s*\d+/.test(t) && el.querySelector('pre, .CodeMirror, [class*="line"]') === null;
    });

    for (const header of headerEls) {
      const label = header.innerText.trim();
      // 在 header 父级或兄弟中找最近 pre / div.line / textarea
      // 1) 先看父元素的下一个兄弟
      let dataEl = null;
      let cursor = header;
      // 向父级回溯找包含 header + 数据的容器
      for (let depth = 0; depth < 4 && cursor; depth++) {
        const candidates = cursor.querySelectorAll('pre, .CodeMirror-code, [class*="content"], textarea');
        for (const c of candidates) {
          if (c !== header && !header.contains(c) && c.innerText?.trim() && c.innerText.length < 5000) {
            dataEl = c;
            break;
          }
        }
        if (dataEl) break;
        cursor = cursor.parentElement;
      }
      if (dataEl) {
        const text = dataEl.innerText.replace(/\u200B/g, '').trim();
        if (text) samples.push({ label, text });
      }
    }
    return samples;
  }

  function buildSchoolOJMarkdown({ title, problemId, fullText, codeBlocks, sampleTabs }) {
    let md = `# ${title}\n\n`;
    if (problemId) md += `_题号 ${problemId}_\n\n`;

    // 把题面里 <pre> 节点的内容替换为 ``` 围栏代码块
    // innerText 把 pre 节点内容也并到 fullText 里，在 fullText 里找到 pre.text 然后替换
    let body = fullText;
    for (const cb of codeBlocks) {
      if (cb.text && body.includes(cb.text)) {
        body = body.replace(cb.text, `\n\`\`\`${cb.lang}\n${cb.text}\n\`\`\`\n`);
      }
    }
    md += body + '\n';

    // 样例（el-tabs 抓出来的 pane 内容）
    if (sampleTabs.length > 0) {
      md += '\n---\n\n## 样例\n\n';
      for (const t of sampleTabs) {
        if (!t.text) continue;
        md += `### ${t.label}\n\n\`\`\`\n${t.text}\n\`\`\`\n\n`;
      }
    }
    return md;
  }

  /** 头歌 educoder 提取 */
  async function extractEducoder() {
    const leftPanel = document.querySelector('section#task-left-panel .scroll___lsiy3');
    if (!leftPanel) throw new Error('未找到题目左面板（section#task-left-panel）');

    const fullText = leftPanel.innerText.trim();
    const titleEl = document.querySelector('h2.shixun-info');
    let title = titleEl?.innerText?.trim() || document.title;
    // 去除 "实验总用时 00:00:10" 这类噪音
    title = title.replace(/实验总用时[：:]\s*[\d:]+/g, '').trim();
    // 去除 "第N关：" 前缀，但保留题名
    const stageNameEl = document.querySelector('.task-name, [class*="task-name"]');
    if (stageNameEl?.innerText) {
      const stageName = stageNameEl.innerText.trim().replace(/^第\d+关[：:]\s*/, '');
      if (stageName && stageName.length > 3) title = stageName;
    }

    // Monaco 编辑器代码：头歌封了 window.monaco，必须用 DOM 滚动抓 view-line
    let initialCode = '';
    const editorsDebug = [];

    // 1) 优先：window.monaco.editor.getEditors()（万一暴露了）
    if (window.monaco?.editor?.getEditors) {
      const editors = window.monaco.editor.getEditors();
      for (const ed of editors) {
        const node = ed.getDomNode?.();
        const v = ed.getValue?.() || '';
        editorsDebug.push({ len: v.length, firstLine: v.split('\n')[0]?.slice(0, 60), source: 'monaco-api' });
        if (v.length > initialCode.length) initialCode = v;
      }
    }

    // 2) DOM 兜底：滚动 + view-line 拼接（最可靠，不依赖任何内部 API）
    if (!initialCode) {
      const codeText = await harvestMonacoByScroll();
      if (codeText) {
        editorsDebug.push({ len: codeText.length, firstLine: codeText.split('\n')[0]?.slice(0, 60), source: 'view-line-scroll' });
        initialCode = codeText;
      }
    }

    // 3) textarea 最后兜底
    if (!initialCode) {
      const ta = document.querySelector('[class*="my-monaco-editor"] textarea, .monaco-editor textarea');
      if (ta?.value) {
        initialCode = ta.value;
        editorsDebug.push({ len: ta.value.length, source: 'textarea-fallback' });
      }
    }

    const images = await collectImages(leftPanel);

    // 抓代码块（头歌用 prettyprint）
    const codeBlocks = [...leftPanel.querySelectorAll('pre.prettyprint, pre.linenums, pre[class*="lang-"]')].map((pre) => {
      const langMatch = pre.className.match(/lang-(\w+)/);
      return { lang: langMatch ? langMatch[1] : '', text: pre.innerText.trim() };
    });

    // 头歌的 tab 切换：学习内容 / 参考答案 / 记录 / 评论
    // 默认抓「学习内容」tab；不主动切换 tab（避免 React state 错乱）
    // 当前 tab 内容 = leftPanel innerText

    // task-id 等元数据
    const pathParts = location.pathname.split('/').filter(Boolean);
    const taskId = pathParts[2];
    const stageId = pathParts[3];

    // 构造结构化 markdown
    const markdown = buildEducoderMarkdown({
      title,
      fullText,
      codeBlocks,
    });

    return {
      source: 'educoder',
      url: location.href,
      title,
      rawText: markdown,
      images,
      initialCode,
      language: detectEducoderLang(initialCode, fullText),
      meta: {
        domain: location.hostname,
        taskId,
        stageId,
        rawInnerText: fullText,
        codeBlocks,
        editorsDebug,
      },
    };
  }

  /**
   * 头歌 monaco 没暴露 window.monaco：用 DOM 滚动 + view-line 拼接
   * Monaco 虚拟滚动 → 不可见的行不在 DOM。需要主动滚动让所有行都被 render。
   * 用 top 像素位置做 key 去重，最终按 top 排序拼接。
   */
  async function harvestMonacoByScroll() {
    const mainContainer =
      document.querySelector('[class*="my-monaco-editor"]') ||
      document.querySelector('[class*="code-area-container"]');
    if (!mainContainer) return '';
    const editor = mainContainer.querySelector('.monaco-editor');
    if (!editor) return '';
    // Monaco 实际滚动容器（v0.30+）
    const scrollable =
      editor.querySelector('.overflow-guard > .monaco-scrollable-element') ||
      editor.querySelector('.monaco-scrollable-element');
    if (!scrollable) return '';

    /** @type {Map<number, string>} */
    const lines = new Map();
    const harvest = () => {
      for (const l of editor.querySelectorAll('.view-line')) {
        const top = parseFloat(l.style.top || '0');
        // \u00A0 是 monaco 渲染空格的非断行空格
        lines.set(top, l.innerText.replace(/\u00A0/g, ' '));
      }
    };

    const origScroll = scrollable.scrollTop;
    // 滚到顶
    scrollable.scrollTop = 0;
    await new Promise((r) => setTimeout(r, 80));
    harvest();

    // 步进滚到底
    let lastTop = -1;
    let safety = 50; // 防死循环
    while (safety-- > 0) {
      const before = scrollable.scrollTop;
      if (before === lastTop) break;
      lastTop = before;
      scrollable.scrollTop += 200;
      await new Promise((r) => setTimeout(r, 60));
      harvest();
      if (scrollable.scrollTop >= scrollable.scrollHeight - scrollable.clientHeight - 1) {
        harvest();
        break;
      }
    }
    // 恢复原滚动位置
    scrollable.scrollTop = origScroll;

    // top 排序拼接
    return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t).join('\n');
  }

  function buildEducoderMarkdown({ title, fullText, codeBlocks }) {
    let md = `# ${title}\n\n`;
    let body = fullText;
    for (const cb of codeBlocks) {
      if (cb.text && body.includes(cb.text)) {
        body = body.replace(cb.text, `\n\`\`\`${cb.lang}\n${cb.text}\n\`\`\`\n`);
      }
    }
    md += body + '\n';
    return md;
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
