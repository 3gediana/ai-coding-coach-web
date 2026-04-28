// ==UserScript==
// @name         AI Coach 题目推送器
// @namespace    https://github.com/aicc-pusher
// @version      0.2.2
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

    // 抽样例：el-tabs 结构（每个 tab-pane 的内容都拼起来）
    // 校内 OJ 样例位于 .el-tabs__content > .el-tab-pane（即使 hidden 也在 DOM）
    const sampleTabs = [...main.querySelectorAll('.el-tabs__content .el-tab-pane')].map((pane) => {
      // pane 标题对应的 tab item
      const idx = [...pane.parentElement.children].indexOf(pane);
      const tabItem = main.querySelectorAll('.el-tabs__item')[idx];
      const label = tabItem?.innerText?.trim() || `样例${idx + 1}`;
      return { label, text: pane.innerText.trim() };
    });

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
      },
    };
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

    // Monaco 编辑器现有代码（多种 editor，选「主代码区」）
    // 头歌页面通常有多个 Monaco：评论框、答案查看、主编辑器
    let initialCode = '';
    const editorsDebug = []; // 诊断：把所有 editor 的状态推过去，方便定位选错问题

    if (window.monaco?.editor?.getEditors) {
      const editors = window.monaco.editor.getEditors();
      // 收集每个 editor 的诊断信息
      for (const ed of editors) {
        const node = ed.getDomNode?.();
        const v = ed.getValue?.() || '';
        editorsDebug.push({
          len: v.length,
          firstLine: v.split('\n')[0]?.slice(0, 60),
          containerClass: node?.parentElement?.parentElement?.className?.slice(0, 100) || '',
          ancestor: ['my-monaco-editor', 'code-area-container', 'monaco-editor-container'].find((c) =>
            node?.closest(`[class*="${c}"]`),
          ) || null,
        });
      }
      // 选主编辑器：优先 .my-monaco-editor / code-area-container 容器
      let mainEditor = null;
      for (const ed of editors) {
        const node = ed.getDomNode?.();
        if (node?.closest('[class*="my-monaco-editor"], [class*="code-area-container"]')) {
          mainEditor = ed;
          break;
        }
      }
      // 兜底：选内容最长的
      if (!mainEditor && editors.length) {
        let bestLen = 0;
        for (const ed of editors) {
          const v = ed.getValue?.() || '';
          if (v.length > bestLen) {
            bestLen = v.length;
            mainEditor = ed;
          }
        }
      }
      if (mainEditor) initialCode = mainEditor.getValue?.() || '';
    }
    // 兜底：textarea
    if (!initialCode) {
      const ta = document.querySelector('[class*="my-monaco-editor"] textarea, .monaco-editor textarea');
      if (ta?.value) initialCode = ta.value;
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
