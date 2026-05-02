// ==UserScript==
// @name         AI Coach 题目推送器
// @namespace    https://github.com/aicc-pusher
// @version      0.3.10
// @description  从校内 OJ / 头歌 educoder 抓题目 → 推送到 AI Coach，并支持 Coach 回填代码；自动提交需显式触发。
// @author       AI Coach
// @match        http://10.11.219.21/*
// @match        https://www.educoder.net/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @connect      localhost
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  if (window.top !== window.self) return;

  const COACH_ORIGINS = ['http://127.0.0.1:3333'];

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

    // 样例区可能在 main.main-container **之外**，扩到 document.body
    const sampleTabs = harvestSchoolOJSamplesByText(document.body);

    // 诊断：含「样例查看模式」字眼的容器（样例区根容器）
    const sampleRoot = findSampleRoot(document.body);
    const allCards = [...document.body.querySelectorAll('.el-card__body')];
    const schoolOJDebug = {
      elCardCount: allCards.length,
      elCardTexts: allCards.map((c, i) => ({
        i,
        len: c.innerText.length,
        head: c.innerText.slice(0, 80).replace(/\n/g, '|'),
        tail: c.innerText.slice(-80).replace(/\n/g, '|'),
      })),
      sampleRootFound: !!sampleRoot,
      sampleRootClass: sampleRoot?.className?.slice(0, 100) || '',
      sampleRootTag: sampleRoot?.tagName || '',
      sampleRootInsideMain: !!sampleRoot && mainContainer.contains(sampleRoot),
      sampleRootText: sampleRoot?.innerText?.slice(0, 600).replace(/\n/g, '|') || '',
      // sampleRoot 内 textarea / pre / [class*=content] 元素数量与首个内容
      sampleRootDataEls: sampleRoot
        ? [...sampleRoot.querySelectorAll('textarea, pre, [class*="content"], [class*="data"]')].slice(0, 10).map((e) => ({
            tag: e.tagName,
            cls: (e.className || '').slice(0, 60),
            len: (e.value || e.innerText || '').length,
            preview: (e.value || e.innerText || '').slice(0, 80).replace(/\n/g, '|'),
          }))
        : [],
      bodyTextSlice: document.body.innerText.slice(
        Math.max(0, document.body.innerText.indexOf('输入样例1') - 50),
        Math.max(0, document.body.innerText.indexOf('输入样例1') + 600),
      ).replace(/\n/g, '|'),
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

  /** 找含「样例查看模式」字眼的容器（样例区根） */
  function findSampleRoot(root) {
    const all = [...root.querySelectorAll('div, section, aside')];
    let best = null;
    let bestSize = Infinity;
    for (const el of all) {
      if (el.innerText?.includes('样例查看模式') && el.innerText?.includes('输入样例')) {
        // 选最小的（最贴近样例区，不是父级巨型容器）
        const size = el.innerText.length;
        if (size < bestSize) {
          bestSize = size;
          best = el;
        }
      }
    }
    return best;
  }

  /**
   * 校内 OJ 样例提取：
   * 1. 用 findSampleRoot 定位样例区
   * 2. 在样例区内找 leaf 元素，textContent 起始为「输入样例N」/「输出样例N」
   * 3. 向父级回溯找含 pre/[class*="line"]/textarea 的容器拿数据
   */
  function harvestSchoolOJSamplesByText(root) {
    const samples = [];
    const sampleRoot = findSampleRoot(root) || root;

    // 找 leaf 元素（textContent 不超过 30 字 + 起始正则匹配）
    const all = [...sampleRoot.querySelectorAll('div, span, h3, h4, label, p, b, strong')];
    const headerEls = all.filter((el) => {
      // 文本节点优先（避免拿到嵌套 textContent）
      const directText = (el.firstChild?.nodeType === 3 ? el.firstChild.textContent : el.textContent).trim();
      if (directText.length > 30 || directText.length < 5) return false;
      if (!/^(输入|输出)样例\s*\d+/.test(directText)) return false;
      // 排除嵌套 (子元素 > 5 个的肯定不是 label)
      if (el.querySelectorAll('div, pre, textarea').length > 3) return false;
      return true;
    });

    // 收集 sampleRoot 内所有数据候选元素（按 DOM 顺序）
    // 只接受 textarea + 排除 language-* 的 pre（题面代码块不是样例数据）
    const allDataEls = [];
    {
      const walker = document.createTreeWalker(sampleRoot, NodeFilter.SHOW_ELEMENT, null);
      let node = walker.nextNode();
      while (node) {
        const tag = node.tagName;
        const cls = typeof node.className === 'string' ? node.className : '';
        const isCandidate =
          tag === 'TEXTAREA' ||
          (tag === 'PRE' && !/language-/.test(cls));
        if (isCandidate) {
          const txt = (node.value || node.innerText || '').replace(/\u200B/g, '').trim();
          if (txt && txt.length < 2000 && !/输入样例|输出样例|样例查看/.test(txt)) {
            allDataEls.push(node);
          }
        }
        node = walker.nextNode();
      }
    }

    // headers 按 label 去重（DOM 里可能有 outer / inner 嵌套都通过 leaf 判断）
    const uniqueHeaders = [];
    const seenLabels = new Set();
    for (const header of headerEls) {
      const directText = (header.firstChild?.nodeType === 3 ? header.firstChild.textContent : header.textContent).trim();
      const m = directText.match(/^(输入|输出)样例\s*\d+/);
      if (!m) continue;
      if (seenLabels.has(m[0])) continue;
      seenLabels.add(m[0]);
      uniqueHeaders.push({ el: header, label: m[0] });
    }

    // 按顺序配对（headers[i] ↔ allDataEls[i]）
    for (let i = 0; i < uniqueHeaders.length && i < allDataEls.length; i++) {
      const { label } = uniqueHeaders[i];
      const dataEl = allDataEls[i];
      const text = (dataEl.value || dataEl.innerText || '').replace(/\u200B/g, '').trim();
      if (text) samples.push({ label, text });
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
      language: detectEducoderLang(initialCode, `${title}\n${fullText}`),
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

  // ─────────── 本地桥接 HTTP ───────────

  function gmRequestJson(path, { method = 'GET', data, timeout = 30_000 } = {}) {
    return new Promise((resolve, reject) => {
      let idx = 0;
      const tryOne = () => {
        const origin = COACH_ORIGINS[idx++];
        GM_xmlhttpRequest({
          method,
          url: origin + path,
          headers: { 'content-type': 'application/json' },
          data: data === undefined ? undefined : JSON.stringify(data),
          timeout,
          onload: (r) => {
            if (r.status >= 200 && r.status < 300) {
              try {
                resolve(JSON.parse(r.responseText || '{}'));
              } catch {
                resolve({ ok: true });
              }
            } else if (idx < COACH_ORIGINS.length) {
              tryOne();
            } else {
              reject(new Error(`HTTP ${r.status}: ${r.responseText?.slice(0, 200)}`));
            }
          },
          onerror: () => {
            if (idx < COACH_ORIGINS.length) tryOne();
            else reject(new Error('网络错误：AI Coach 是否在 3333 端口运行？'));
          },
          ontimeout: () => {
            if (idx < COACH_ORIGINS.length) tryOne();
            else reject(new Error('超时（30s）'));
          },
        });
      };
      tryOne();
    });
  }

  function pushPayload(payload) {
    return gmRequestJson('/__import', { method: 'POST', data: payload });
  }

  async function pollOjCommand(site) {
    if (!isProblemPage(site)) return null;
    const q = `?source=${encodeURIComponent(site)}&url=${encodeURIComponent(location.href)}`;
    const data = await gmRequestJson(`/__oj-next-command${q}`, { timeout: 8_000 }).catch(() => null);
    return data?.command || null;
  }

  function postOjResult(result) {
    return gmRequestJson('/__oj-result', { method: 'POST', data: result, timeout: 15_000 });
  }

  function postDebugLog(event, extra = {}) {
    const payload = {
      event,
      site: detectSite(),
      href: location.href,
      visible: document.visibilityState,
      focused: document.hasFocus?.() ?? null,
      title: document.title,
      ...extra,
    };
    gmRequestJson('/__oj-debug-log', { method: 'POST', data: payload, timeout: 5_000 }).catch(() => {});
    console.log('[aicc-pusher-debug]', payload);
  }

  // ─────────── OJ 回填 / 提交 ───────────

  async function executeOjCommand(command) {
    const code = sanitizeCodePayload(command.code);
    postDebugLog('command-received', {
      commandId: command.id,
      source: command.source,
      autoSubmit: command.autoSubmit,
      codeLength: code.length,
      rawCodeLength: command.code?.length ?? 0,
    });
    showToast(`收到 AI Coach ${command.autoSubmit ? '提交' : '回填'}命令：${command.problemTitle || command.fileName}`, 'info');
    try {
      if (command.source === 'educoder') {
        await setEducoderCode(code);
      } else if (command.source === 'school-oj') {
        await setSchoolOjCode(code);
      } else {
        throw new Error(`不支持的 OJ：${command.source}`);
      }
      postDebugLog('code-filled', { commandId: command.id, source: command.source });
      if (!command.autoSubmit) {
        await postOjResult({
          id: command.id,
          source: command.source,
          url: location.href,
          status: 'filled',
          rawText: '',
          message: '已清空编辑器并写入 AI Coach 代码，未自动提交',
          finishedAt: Date.now(),
        });
        showToast('已写入 AI Coach 代码，未自动提交', 'ok');
        return;
      }
      showToast('已清空编辑器并写入 AI Coach 代码，准备提交…', 'ok');
      const beforeSubmitText = collectVerdictText(command.source);
      await clickSubmitButton(command.source);
      const verdict = await waitForVerdict(command.source, 5 * 60_000, beforeSubmitText);
      await postOjResult({
        id: command.id,
        source: command.source,
        url: location.href,
        status: 'done',
        verdict: verdict.verdict,
        rawText: verdict.rawText,
        message: verdict.message,
        finishedAt: Date.now(),
      });
      showToast(`OJ 判题完成：${verdict.verdict}`, verdict.verdict === 'AC' ? 'ok' : 'err');
    } catch (err) {
      postDebugLog('command-error', {
        commandId: command.id,
        source: command.source,
        message: err.message || String(err),
        stack: err.stack || null,
      });
      await postOjResult({
        id: command.id,
        source: command.source,
        url: location.href,
        status: 'failed',
        verdict: 'OTHER',
        rawText: '',
        message: err.message || String(err),
        finishedAt: Date.now(),
      }).catch(() => {});
      showToast(`自动提交失败：${err.message || err}`, 'err');
    }
  }

  async function setEducoderCode(code) {
    postDebugLog('educoder-fill-start', {
      codeLength: code.length,
      monacoTextareaCount: document.querySelectorAll('#task-right-panel .monaco-editor textarea.inputarea, #task-right-panel [class*="my-monaco-editor"] textarea.inputarea, .monaco-editor textarea.inputarea, [class*="my-monaco-editor"] textarea').length,
      taskRightPanel: !!document.querySelector('#task-right-panel'),
    });
    const editors = window.monaco?.editor?.getEditors?.() || [];
    for (const ed of editors) {
      if (ed?.setValue && ed?.getDomNode?.()) {
        ed.setValue('');
        await sleep(50);
        ed.setValue(code);
        ed.focus?.();
        return;
      }
    }

    const models = window.monaco?.editor?.getModels?.() || [];
    if (models.length > 0 && models[0]?.setValue) {
      models[0].setValue('');
      await sleep(50);
      models[0].setValue(code);
      return;
    }

    const ta = findEducoderMonacoTextarea();
    if (!ta) throw new Error('未找到头歌 Monaco 编辑器 textarea');
    postDebugLog('educoder-textarea-found', { textareaClass: ta.className, textareaValueLength: ta.value?.length ?? 0 });
    const ok = await writeIntoMonacoTextarea(ta, code);
    if (!ok) postDebugLog('educoder-fill-unverified', { renderedPreview: monacoRenderedPreview(ta.closest('.monaco-editor') || ta.closest('[class*="my-monaco-editor"]') || ta) });
  }

  async function setSchoolOjCode(code) {
    postDebugLog('school-fill-start', {
      codeLength: code.length,
      codeMirrorCount: document.querySelectorAll('.CodeMirror').length,
      textareaCount: document.querySelectorAll('.vue-codemirror-wrap textarea, textarea').length,
    });
    const cmEls = document.querySelectorAll('.CodeMirror');
    for (const cm of cmEls) {
      if (cm.CodeMirror?.setValue) {
        cm.CodeMirror.setValue('');
        await sleep(50);
        cm.CodeMirror.setValue(code);
        cm.CodeMirror.focus?.();
        const value = cm.CodeMirror.getValue?.() ?? '';
        postDebugLog('school-codemirror-filled', { valueLength: value.length, exact: normalizeCode(value) === normalizeCode(code) });
        return;
      }
    }
    const ta = document.querySelector('.vue-codemirror-wrap textarea, textarea');
    if (!ta) throw new Error('未找到校内 OJ 代码编辑器');
    ta.focus();
    await replaceFocusedEditorContent(ta, code);
  }

  function findEducoderMonacoTextarea() {
    const candidates = [...document.querySelectorAll(
      '#task-right-panel .monaco-editor textarea.inputarea, #task-right-panel [class*="my-monaco-editor"] textarea.inputarea, .monaco-editor textarea.inputarea, [class*="my-monaco-editor"] textarea',
    )];
    return candidates.find((ta) => {
      const editor = ta.closest('.monaco-editor') || ta.closest('[class*="my-monaco-editor"]');
      if (!editor) return false;
      const r = editor.getBoundingClientRect();
      const cs = getComputedStyle(editor);
      return r.width > 100 && r.height > 100 && cs.display !== 'none' && cs.visibility !== 'hidden';
    }) || candidates[0] || null;
  }

  async function writeIntoMonacoTextarea(ta, code) {
    const editor = ta.closest('.monaco-editor') || ta.closest('[class*="my-monaco-editor"]') || ta;
    editor.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    editor.click?.();
    ta.focus();
    await sleep(80);
    await replaceFocusedEditorContent(ta, code);
    await sleep(600);
    if (monacoEditorMatches(editor, code)) {
      postDebugLog('monaco-verified-after-replace', { renderedPreview: monacoRenderedPreview(editor) });
      return true;
    }
    postDebugLog('monaco-verify-failed-after-single-replace', { renderedPreview: monacoRenderedPreview(editor) });
    return false;
  }

  async function replaceFocusedEditorContent(target, code) {
    target.focus();
    await sleep(40);
    dispatchEditorKey(target, 'a', { ctrlKey: true, metaKey: navigator.platform.includes('Mac'), code: 'KeyA', keyCode: 65 });
    await sleep(80);
    document.execCommand('selectAll');
    dispatchEditorKey(target, 'Delete', { code: 'Delete', keyCode: 46 });
    document.execCommand('delete');
    await sleep(120);
    if (document.execCommand('insertText', false, code)) return;
    if (dispatchSyntheticPaste(target, code)) return;
    target.value = code;
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: code }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function dispatchSyntheticPaste(target, code) {
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', code);
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      return target.dispatchEvent(ev);
    } catch {
      return false;
    }
  }

  function dispatchEditorKey(target, key, init = {}) {
    const eventInit = {
      key,
      code: init.code || key,
      keyCode: init.keyCode || 0,
      which: init.keyCode || 0,
      ctrlKey: !!init.ctrlKey,
      metaKey: !!init.metaKey,
      shiftKey: !!init.shiftKey,
      altKey: !!init.altKey,
      bubbles: true,
      cancelable: true,
    };
    target.dispatchEvent(new KeyboardEvent('keydown', eventInit));
    target.dispatchEvent(new KeyboardEvent('keyup', eventInit));
  }

  function monacoEditorMatches(editor, code) {
    const candidates = [];
    const textareaValue = editor.querySelector('textarea')?.value;
    if (textareaValue) candidates.push(textareaValue);
    const rendered = monacoRenderedPreview(editor);
    if (rendered) candidates.push(rendered);
    const expected = normalizeCode(code);
    return candidates.some((value) => {
      const actual = normalizeCode(value);
      return actual === expected || (actual.length > 0 && expected.startsWith(actual));
    });
  }

  function monacoRenderedPreview(editor) {
    return [...editor.querySelectorAll('.view-line')]
      .map((line) => (line.innerText || '').replace(/\u00A0/g, ' ').trim())
      .join('\n')
      .slice(0, 500);
  }

  function normalizeCode(code) {
    return String(code || '').replace(/\r\n/g, '\n').replace(/\s+$/gm, '').trim();
  }

  function sanitizeCodePayload(code) {
    let text = String(code ?? '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n```$/);
    if (fenced) return fenced[1].replace(/\r\n/g, '\n');
    if (trimmed.length >= 2 && trimmed.startsWith('`') && trimmed.endsWith('`') && !trimmed.startsWith('```')) {
      return trimmed.slice(1, -1).replace(/\r\n/g, '\n');
    }
    return text;
  }

  async function clearAndPasteIntoFocused(code) {
    await replaceFocusedEditorContent(document.activeElement, code);
  }

  async function clickSubmitButton(site) {
    const patterns = site === 'educoder'
      ? [/提交评测/, /评测/, /提交/, /运行评测/, /保存并评测/]
      : [/提交/, /评测/, /运行/];
    const btn = findClickableByText(patterns);
    if (!btn) throw new Error('未找到提交/评测按钮');
    btn.click();
    await sleep(1000);
  }

  function findClickableByText(patterns) {
    const candidates = [...document.querySelectorAll('button, a, [role="button"], .ant-btn, .el-button')];
    return candidates.find((el) => {
      const text = (el.innerText || el.textContent || '').replace(/\s+/g, '');
      if (!text) return false;
      const disabled = el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/.test(el.className || '');
      return !disabled && patterns.some((p) => p.test(text));
    });
  }

  async function waitForVerdict(site, timeoutMs, previousText = '') {
    const start = Date.now();
    let lastText = '';
    while (Date.now() - start < timeoutMs) {
      await sleep(1500);
      const rawText = collectVerdictText(site);
      lastText = rawText || lastText;
      if (previousText && normalizeText(rawText) === normalizeText(previousText)) continue;
      if (/代码执行中|评测中|运行中|judging|running|pending/i.test(rawText)) continue;
      const verdict = parseVerdict(rawText);
      if (verdict) return { verdict, rawText, message: rawText.slice(0, 300) };
    }
    return { verdict: 'OTHER', rawText: lastText, message: '等待判题结果超时' };
  }

  function collectVerdictText(site) {
    const selectors = site === 'educoder'
      ? ['[class*="result"]', '[class*="test"]', '[class*="grade"]', '[class*="evaluate"]', '.ant-message', '.ant-modal', '.task-right-panel']
      : ['[class*="result"]', '[class*="status"]', '[class*="judge"]', '.el-message', '.el-card'];
    const parts = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const t = (el.innerText || '').trim();
        if (t && t.length < 4000) parts.push(t);
      }
    }
    parts.push((document.body.innerText || '').slice(-3000));
    return [...new Set(parts)].join('\n---\n');
  }

  function parseVerdict(text) {
    if (!text) return null;
    if (/编译(错误|失败)|Compilation Error|\bCE\b/i.test(text)) return 'CE';
    if (/运行时错误|Runtime Error|\bRE\b|段错误|signal|exception/i.test(text)) return 'RE';
    if (/时间超限|超时|Time Limit|\bTLE\b/i.test(text)) return 'TLE';
    if (/内存超限|Memory Limit|\bMLE\b/i.test(text)) return 'MLE';
    if (/答案错误|Wrong Answer|\bWA\b|测试未通过|未通过|不通过|结果错误/i.test(text)) return 'WA';
    if (/评测通过|通过评测|恭喜.*通过|Accepted|\bAC\b|Congratulations|全部通过|测试通过/i.test(text)) return 'AC';
    const ratio = text.match(/(\d+)\s*\/\s*(\d+)/);
    if (ratio && Number(ratio[1]) === Number(ratio[2]) && Number(ratio[2]) > 0) return 'AC';
    return null;
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  let commandRunning = false;
  async function pollCommandsTick() {
    if (commandRunning) return;
    const site = detectSite();
    if (!site || !isProblemPage(site)) return;
    if (document.visibilityState !== 'visible') {
      postDebugLog('poll-skipped-hidden');
      return;
    }
    const cmd = await pollOjCommand(site);
    if (!cmd) return;
    postDebugLog('command-polled', { commandId: cmd.id, source: cmd.source, autoSubmit: cmd.autoSubmit });
    commandRunning = true;
    try {
      await executeOjCommand(cmd);
    } finally {
      commandRunning = false;
    }
  }

  // ─────────── UI ───────────

  const UI_POS_KEY = 'aicc_pusher_fab_pos_v1';
  const UI_COLLAPSED_KEY = 'aicc_pusher_fab_collapsed_v1';
  let collapsed = localStorage.getItem(UI_COLLAPSED_KEY) === '1';

  function readFabPos() {
    try {
      const raw = localStorage.getItem(UI_POS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (typeof p.x === 'number' && typeof p.y === 'number') return p;
    } catch {
      /* ignore */
    }
    return null;
  }

  function saveFabPos(x, y) {
    localStorage.setItem(UI_POS_KEY, JSON.stringify({ x, y }));
  }

  function placeFab(el) {
    const pos = readFabPos();
    if (pos) {
      const x = Math.max(8, Math.min(window.innerWidth - 56, pos.x));
      const y = Math.max(8, Math.min(window.innerHeight - 56, pos.y));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    } else {
      el.style.right = '18px';
      el.style.bottom = '18px';
      el.style.left = 'auto';
      el.style.top = 'auto';
    }
  }

  function setCollapsed(next) {
    collapsed = next;
    localStorage.setItem(UI_COLLAPSED_KEY, collapsed ? '1' : '0');
    if (btn) {
      btn.classList.toggle('collapsed', collapsed);
      btn.innerHTML = collapsed ? 'AI' : '📤 推送到 AI Coach';
      btn.title = collapsed
        ? 'AI Coach 推送器（双击展开，拖动可移动）'
        : '推送当前题目到 AI Coach（双击收起，拖动可移动）';
    }
  }

  function makeDraggable(el) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    let lastClick = 0;
    let suppressClick = false;

    el.addEventListener('pointerdown', (e) => {
      if (el.disabled) return;
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      const r = el.getBoundingClientRect();
      baseX = r.left;
      baseY = r.top;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('dragging');
    });

    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
      const x = Math.max(8, Math.min(window.innerWidth - el.offsetWidth - 8, baseX + dx));
      const y = Math.max(8, Math.min(window.innerHeight - el.offsetHeight - 8, baseY + dy));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    });

    el.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('dragging');
      el.releasePointerCapture?.(e.pointerId);
      const r = el.getBoundingClientRect();
      saveFabPos(r.left, r.top);
      const now = Date.now();
      if (!moved && now - lastClick < 320) {
        setCollapsed(!collapsed);
        suppressClick = true;
      }
      lastClick = now;
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    el.addEventListener('click', (e) => {
      if (moved || suppressClick) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick = false;
      }
    }, true);
  }

  function injectStyles() {
    const css = `
    .aicc-push-btn {
      position: fixed; right: 18px; bottom: 18px; z-index: 999999;
      min-width: 46px; min-height: 34px;
      padding: 9px 14px; border-radius: 999px;
      background: linear-gradient(135deg, #ff6b00, #ffaa00);
      color: white; font-size: 13px; font-weight: 600;
      border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(0,0,0,.2);
      font-family: system-ui, sans-serif;
      opacity: .42;
      backdrop-filter: blur(8px);
      user-select: none;
      touch-action: none;
      transition: opacity .15s, transform .15s, box-shadow .15s, min-width .15s, padding .15s;
      display: flex; align-items: center; gap: 6px;
    }
    .aicc-push-btn:hover {
      opacity: .96;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0,0,0,.3);
    }
    .aicc-push-btn.dragging {
      opacity: .96;
      transform: scale(1.02);
      cursor: grabbing;
    }
    .aicc-push-btn.collapsed {
      width: 38px; height: 38px; min-width: 38px; min-height: 38px;
      padding: 0; justify-content: center;
      font-size: 12px; letter-spacing: .02em;
      background: rgba(255,107,0,.72);
      box-shadow: 0 2px 10px rgba(0,0,0,.18);
    }
    .aicc-push-btn:disabled {
      opacity: .7; cursor: wait;
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
    placeFab(btn);
    makeDraggable(btn);
    setCollapsed(collapsed);
    btn.title = `从 ${site === 'school-oj' ? '校内 OJ' : '头歌'} 抓取当前题目并推送到 AI Coach (3333)。拖动可移动，双击可收纳/展开。`;

    btn.addEventListener('click', async () => {
      if (collapsed) {
        setCollapsed(false);
        return;
      }
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
          btn.innerHTML = collapsed ? 'AI' : '📤 推送到 AI Coach';
          btn.classList.remove('ok');
          btn.disabled = false;
        }, 3000);
      } catch (err) {
        console.error('[aicc-pusher]', err);
        btn.innerHTML = '❌ 推送失败';
        btn.classList.add('err');
        showToast(`推送失败：${err.message}\n确认 AI Coach 在 3333 端口运行`, 'err');
        setTimeout(() => {
          btn.innerHTML = collapsed ? 'AI' : '📤 推送到 AI Coach';
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
    setInterval(() => {
      pollCommandsTick().catch((err) => console.warn('[aicc-pusher] 轮询提交命令失败', err));
    }, 2_000);

    postDebugLog('script-loaded', { version: '0.3.10' });
    console.log('[aicc-pusher] 已加载：支持题目推送 + AI Coach 回填代码；自动提交需显式触发');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
