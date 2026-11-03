// M8 · 保存为「完整 HTML 文件」
//
// 实现方式：**直接复用 SingleFile 的核心处理内核**（lib/single-file.js，AGPL-3.0，作者 Gildas Lormeau）。
// 之前我自研的"克隆 DOM + 正则替换 url()"方案效果很差（资源大量漏抓、页面支离破碎），
// 桔子要求不要重新发明轮子 —— 所以这里改为：驱动它完整的处理器链（懒加载触发、
// CSSOM 遍历、srcset/字体/iframe/canvas…），只保留我们自己的进度条与下载外壳。
//
// 内核需要的两个钩子（照抄 content-fetch.js 的三级策略，这是它抓得全的关键）：
//   ① 页面内 fetch（referrerPolicy=strict-origin-when-cross-origin，带同源 cookie/referer）
//   ② 401/403/404 → 去掉 referrer 重试
//   ③ 页面内彻底失败 → 转后台代抓（扩展后台 XHR 不受 CSP/CORS 限制）
// 我之前错在：所有资源直接丢后台 + credentials:'include'，CORS 直接拒绝，
// 又把失败静默吞掉 → 结果几乎一个资源都没内联。
//
// 进度：复用 window.joppOverlay（与保存 PDF 同一个组件：全屏置灰 + 红条 + 百分比），
//       单位从「屏」换成「个资源」；内核的 RESOURCES_INITIALIZED 事件会给出资源总数 max。
(function () {
  if (window.__pagesaverHtmlSaveReady) return;
  window.__pagesaverHtmlSaveReady = true;

  const UI_MARK = 'data-jopp-picker-ui';

  // ---------- fetch 钩子：后台代抓的回传通道 ----------
  // 后台抓完后分片回传 singlefile.fetchResponse，按 requestId 归位。
  const pendingResponses = new Map();
  let requestId = 0;

  browser.runtime.onMessage.addListener(function (message) {
    if (!message || message.method !== 'singlefile.fetchResponse') return undefined;

    const p = pendingResponses.get(message.requestId);
    if (!p) return Promise.resolve({});

    if (message.error) {
      p.reject(new Error(message.error));
      pendingResponses.delete(message.requestId);
      return Promise.resolve({});
    }

    if (message.truncated) {
      // 大资源分片到达，攒到最后一片再兑现
      p.array = p.array ? p.array.concat(message.array) : message.array;
      if (!message.finished) {
        pendingResponses.set(message.requestId, p);
        return Promise.resolve({});
      }
      message.array = p.array;
    }

    p.resolve({
      status: message.status,
      headers: new Headers(message.headers || []),
      arrayBuffer: async function () { return new Uint8Array(message.array || []).buffer; }
    });
    pendingResponses.delete(message.requestId);
    return Promise.resolve({});
  });

  // 页面内 fetch（用页面自己的 window.fetch，带同源 cookie 与 referer）
  const pageFetch = (typeof window !== 'undefined' && window.fetch) ? window.fetch.bind(window) : null;

  // 单次 fetch 加超时：国内访问 GitHub Pages / 外部 CDN 常有连接挂起（永远 pending），
  // 不设超时就会卡死在「正在分析页面…」。用 AbortController 兜底，到时间直接 abort →
  // 走 no-referrer 重试 → 后台代抓；任何一级超时就放弃该资源（SingleFile 会优雅跳过漏抓的资源）。
  const FETCH_TIMEOUT = 20000;
  function fetchWithTimeout(url, fetchOptions) {
    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT);
    let signal = controller.signal;
    try {
      if (fetchOptions.signal && typeof AbortSignal !== 'undefined' && AbortSignal.any) {
        signal = AbortSignal.any([controller.signal, fetchOptions.signal]);
      }
    } catch (e) { /* 忽略，用我们自己的 signal 即可 */ }
    const opts = Object.assign({}, fetchOptions, { signal: signal });
    return pageFetch(url, opts).finally(function () { clearTimeout(timer); });
  }

  async function fetchResource(url, options, useHostFetch) {
    options = options || {};
    if (useHostFetch === undefined) useHostFetch = true;

    try {
      if (!pageFetch) throw new Error(PageSaverI18n.t('ui_236907d5b06e'));
      const fetchOptions = {
        cache: options.cache || 'force-cache',
        headers: options.headers,
        referrerPolicy: options.referrerPolicy || 'strict-origin-when-cross-origin'
      };
      const response = await fetchWithTimeout(url, fetchOptions);
      // 防盗链 / 权限问题：去掉 referrer 再试一次
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        if (fetchOptions.referrerPolicy !== 'no-referrer' && !options.referrer) {
          return await fetchResource(url, Object.assign({}, options, { referrerPolicy: 'no-referrer' }), useHostFetch);
        }
      }
      return response;
    } catch (error) {
      if (options.referrerPolicy !== 'no-referrer' && !options.referrer) {
        return await fetchResource(url, Object.assign({}, options, { referrerPolicy: 'no-referrer' }), useHostFetch);
      }
      // 页面内走不通 → 后台代抓（第三级兜底）；同样加超时，避免后台 XHR 挂起把整次保存卡死
      requestId++;
      const id = requestId;
      const bgPromise = new Promise(function (resolve, reject) {
        pendingResponses.set(id, { resolve: resolve, reject: reject, array: null });
      });
      const timeoutPromise = new Promise(function (_, reject) {
        setTimeout(function () { pendingResponses.delete(id); reject(new Error(PageSaverI18n.t('ui_199dfacc58d8'))); }, FETCH_TIMEOUT);
      });
      try {
        await browser.runtime.sendMessage({
          method: 'singlefile.fetch', url: url, requestId: id,
          referrer: options.referrer, headers: options.headers, cache: options.cache
        });
      } catch (e) {
        pendingResponses.delete(id);
        throw e;
      }
      return Promise.race([bgPromise, timeoutPromise]);
    }
  }

  async function frameFetch(url, options) {
    options = options || {};
    const timeoutPromise = new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(PageSaverI18n.t('ui_406900a91b27'))); }, FETCH_TIMEOUT);
    });
    const msgPromise = browser.runtime.sendMessage({
      method: 'singlefile.fetchFrame', url: url,
      frameId: options.frameId, referrer: options.referrer,
      headers: options.headers, cache: options.cache
    });
    const response = await Promise.race([msgPromise, timeoutPromise]);
    if (!response || response.error) throw new Error((response && response.error) || PageSaverI18n.t('ui_a41d2c4ca0e9'));
    return {
      status: response.status,
      headers: new Headers(response.headers || []),
      arrayBuffer: async function () { return new Uint8Array(response.array || []).buffer; }
    };
  }

  // ---------- 收尾提示 ----------
  function showToast(ok, text) {
    const d = document.createElement('div');
    d.setAttribute(UI_MARK, '1');
    d.style.cssText =
      'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 16px;border-radius:8px;font:13px/1.5 system-ui,-apple-system,sans-serif;color:#fff;' +
      'background:' + (ok ? '#0a7d3b' : '#b3261e') + ';box-shadow:0 8px 24px rgba(0,0,0,.4);';
    d.textContent = text;
    (document.body || document.documentElement).appendChild(d);
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 5200);
  }

  // 内核处理的是真实 document，我们的进度条 UI 会被一起处理进去 ——
  // 处理完再从产出的 HTML 里把带 UI_MARK 的元素摘掉（解析成 DOM 删节点，比正则可靠）。
  function stripOwnUi(html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodes = doc.querySelectorAll('[' + UI_MARK + ']');
      if (!nodes.length) return html;
      nodes.forEach(function (n) { n.remove(); });
      return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
    } catch (e) {
      return html; // 摘不掉也不能把成果丢了，最多多带几个 UI 节点
    }
  }

  // 把常见懒加载属性提升为真实 src/srcset。
  // textfold 的 5 个"动图"里只有第 1 个写了真 src，其余 4 个是 <video data-src="*.mp4">
  // （连 src 都没有）。不提升的话内核没有可内联的地址，保存下来只剩 poster 静态图。
  // 只对「原本没有任何 src」的元素动手，避免覆盖页面已有的正确地址。
  function promoteLazyMedia() {
    const LAZY_SRC = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'data-actualsrc'];
    const LAZY_SRCSET = ['data-srcset', 'data-lazy-srcset'];
    let promoted = 0;
    try {
      const nodes = document.querySelectorAll('video, source, img');
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el.getAttribute('src')) {
          for (let j = 0; j < LAZY_SRC.length; j++) {
            const v = el.getAttribute(LAZY_SRC[j]);
            if (v) { el.setAttribute('src', v); promoted++; break; }
          }
        }
        if (!el.getAttribute('srcset')) {
          for (let j = 0; j < LAZY_SRCSET.length; j++) {
            const v = el.getAttribute(LAZY_SRCSET[j]);
            if (v) { el.setAttribute('srcset', v); promoted++; break; }
          }
        }
      }
    } catch (e) { /* 页面 DOM 异常不影响主流程 */ }
    return promoted;
  }

  // ---------- 视频/音频处理（v0.4.11 改写）----------
  // 旧做法（v0.4.8~0.4.10）把 MP4 预内联成 data URI 写回 live DOM，再交给内核 getPageData。
  // 问题：5 个 MP4 内联后 live 文档涨到 5MB+，内核在 finalize 阶段处理这种超大内联数据会
  // 卡死/极慢（症状：永久卡在「正在生成 HTML 文件… 100%」，连 60s 看门狗都救不回体验）。
  // 新做法：先把 <video>/<audio> 换成轻量占位 div（只带原始 src/poster/尺寸），让内核只处理
  // 小文档；等 getPageData 返回最终 HTML 字符串后，再在这里把占位 div 逐个还原成真正可播放的
  // <video autoplay muted loop playsinline src="data:...">。此时已脱离内核，绝不会再卡。
  // 还原时逐个页内 fetch MP4（25s/视频超时，单个失败只保留原相对地址），用字符串替换而非
  // DOMParser，避免对 5MB+ 巨文档二次解析。
  function guessMime(url) {
    const ext = (String(url).split('.').pop() || '').toLowerCase().split(/[?#]/)[0];
    const map = {
      mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg', ogv: 'video/ogg',
      mov: 'video/quicktime', m4v: 'video/mp4', mp3: 'audio/mpeg', wav: 'audio/wav',
      oga: 'audio/ogg', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp'
    };
    return map[ext] || 'application/octet-stream';
  }

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // 把视频/音频元素从 live DOM 中换成轻量占位 div，避免内核 getPageData 在 finalize 阶段
  // 处理超大内联数据而卡死。占位 div 携带原始 src/poster/尺寸，供 ensureMediaPlayable 事后还原。
  // 返回找到的媒体数量（用于进度提示）。
  function stashVideos() {
    let count = 0;
    const medias = Array.from(document.querySelectorAll('video, audio'));
    medias.forEach(function (el) {
      const srcEl = el.matches && el.matches('[src]') ? el : el.querySelector('[src]');
      if (!srcEl || !el.parentNode) return;
      const url = srcEl.getAttribute('src');
      if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;
      const abs = (function () { try { return new URL(url, location.href).href; } catch (e) { return url; } })();
      const ph = document.createElement('div');
      ph.setAttribute('data-pagesaver-media', String(count));
      ph.setAttribute('data-src', abs);
      const poster = el.getAttribute('poster'); if (poster) ph.setAttribute('data-poster', poster);
      const w = el.getAttribute('width'); if (w) ph.setAttribute('data-w', w);
      const h = el.getAttribute('height'); if (h) ph.setAttribute('data-h', h);
      const aria = el.getAttribute('aria-label'); if (aria) ph.setAttribute('data-aria', aria);
      el.parentNode.replaceChild(ph, el);
      count++;
    });
    return count;
  }

  // 收尾：把占位 div 还原成真正可播放的 <video>。
  // 这里才去抓 MP4（页内 fetchResource，25s/视频超时，单个失败只保留原地址），
  // 此时已脱离内核处理，绝不会再卡在「正在生成 HTML 文件…」100%。
  // 用字符串替换而非 DOMParser，避免对 5MB+ 巨文档二次解析（解析本身也可能慢）。
  // 同时强制补 autoplay/muted/loop/playsinline —— 浏览器允许 file:// 下静音自动播放。
  //
  // ⚠️ 健壮性（v0.4.12 加固）：之前某次产物里 5 个视频全变成空占位 div、0 个 <video>，
  // 根因是 prog/ping 在主 try 内、内层 try 之外调用——一旦 overlay.set 之类抛错，
  // 外层 catch 直接 return html（原样），占位 div 原封不动留下。现在：
  //   ① prog/ping 各自包一层 safe 包装，绝不向外抛；
  //   ② 每个视频独立 try，单个失败只保留原地址，不影响其余；
  //   ③ 主循环结束后再做「安全网」正则兜底：任何残留占位 div 都强行变成 <video>（指向原地址），
  //      绝不留空 div；整函数最外层也再兜一层，保证「绝不把成果弄丢成空白占位」。
  async function ensureMediaPlayable(html, pageUrl, prog, ping) {
    const safeProg = function () { try { if (prog) prog.apply(null, arguments); } catch (e) {} };
    const safePing = function () { try { if (ping) ping(); } catch (e) {} };
    const PLACEHOLDER = /<div\b[^>]*\bdata-pagesaver-media="\d+"[^>]*>[\s\S]*?<\/div>/g;
    const makeVideo = function (full) {
      const get = function (name) {
        const x = new RegExp('\\b' + name + '="([^"]*)"').exec(full);
        return x ? x[1] : '';
      };
      const url = get('data-src').replace(/&amp;/g, '&');
      let t = '<video autoplay muted loop playsinline';
      const poster = get('data-poster');
      if (poster) t += ' poster="' + poster.replace(/"/g, '&quot;') + '"';
      const w = get('data-w'), h = get('data-h'), aria = get('data-aria');
      if (w) t += ' width="' + w + '"';
      if (h) t += ' height="' + h + '"';
      if (aria) t += ' aria-label="' + aria.replace(/"/g, '&quot;') + '"';
      t += ' src="' + (url || '').replace(/"/g, '&quot;') + '"></video>';
      return t;
    };
    try {
      const matches = [];
      let m;
      const re = new RegExp(PLACEHOLDER.source, 'g');
      while ((m = re.exec(html)) !== null) matches.push(m);
      for (let i = 0; i < matches.length; i++) {
        const full = matches[i][0];
        safeProg(PageSaverI18n.t('ui_493ca70a3a71') + (i + 1) + '/' + matches.length + ')', i, matches.length, false);
        safePing();
        const get = function (name) {
          const x = new RegExp('\\b' + name + '="([^"]*)"').exec(full);
          return x ? x[1] : '';
        };
        let url = get('data-src').replace(/&amp;/g, '&');
        const poster = get('data-poster');
        const w = get('data-w');
        const h = get('data-h');
        const aria = get('data-aria');
        let src = url;
        if (url) {
          try {
            const resp = await withTimeout(
              fetchResource(url, { referrerPolicy: 'strict-origin-when-cross-origin' }, true),
              25000, PageSaverI18n.t('ui_354180c53045')
            );
            if (resp && resp.ok) {
              const buf = await resp.arrayBuffer();
              const mime = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || guessMime(url);
              src = 'data:' + mime + ';base64,' + arrayBufferToBase64(buf);
            }
          } catch (e) { /* 抓不到就保留原地址，至少元素不丢 */ }
        }
        let tag = '<video autoplay muted loop playsinline';
        if (w) tag += ' width="' + w + '"';
        if (h) tag += ' height="' + h + '"';
        if (poster) tag += ' poster="' + poster.replace(/"/g, '&quot;') + '"';
        if (aria) tag += ' aria-label="' + aria.replace(/"/g, '&quot;') + '"';
        tag += ' src="' + src.replace(/"/g, '&quot;') + '"></video>';
        html = html.split(full).join(tag);
      }
      // 安全网：主循环后若仍有残留占位（极端情况），强行变成 <video>，绝不留空 div
      html = html.replace(PLACEHOLDER, function (full) { return makeVideo(full); });
      return html;
    } catch (e) {
      // 任何未知异常都不能把成果弄丢：至少把占位换成指向原地址的 <video>
      try {
        return html.replace(PLACEHOLDER, function (full) { return makeVideo(full); });
      } catch (e2) { return html; }
    }
  }

  // UI filename only; the background owns destination selection and saving.
  function safeFileName(title) {
    const t = String(title || 'page').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 80);
    return t || 'page';
  }



  // 给任意 promise 加超时，避免后台消息/下载挂起导致进度条永久转圈。
  function withTimeout(promise, ms, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise(function (_, rej) {
        setTimeout(function () { rej(new Error((label || PageSaverI18n.t('ui_ed31fbb483ee')) + PageSaverI18n.t('ui_cfe64acbcc3e') + Math.round(ms / 1000) + 's）')); }, ms);
      })
    ]);
  }

  // 内核定位：Firefox 的 content script 沙箱里，`globalThis` 与页面 `window`
  // 不是同一个对象，UMD 把导出挂在哪个上不一定。lib/single-file.js 已被
  // tools/wrap-kernel.mjs 包了一层强制挂到 window，这里仍把所有可能的
  // 挂载点找一遍，避免再被环境差异绊倒。
  function findKernel() {
    const roots = [];
    const push = function (o) { if (o && roots.indexOf(o) < 0) roots.push(o); };
    try { push(window); } catch (e) { /* 沙箱异常时忽略 */ }
    try { push(globalThis); } catch (e) { /* 同上 */ }
    try { push(self); } catch (e) { /* 同上 */ }
    try { push(document.defaultView); } catch (e) { /* 同上 */ }
    try { if (document.defaultView && document.defaultView.top) push(document.defaultView.top); } catch (e) { /* 跨域 iframe 取不到 */ }

    for (let i = 0; i < roots.length; i++) {
      let k = null;
      try { k = roots[i].singlefile; } catch (e) { continue; }
      if (k && typeof k.getPageData === 'function') return k;
    }
    return null;
  }

  // 进度条 / 工具栏角标更新：saveAsHtml 与 saveAsMarkdown 共用，故放在模块级，
  // 避免各自闭包里重复定义（之前 saveAsMarkdown 因引用不到 saveAsHtml 内部的 prog/badge 而直接抛 ReferenceError）。
  function prog(text, d, t, indeterminate) {
    const overlay = window.joppOverlay;
    if (overlay) {
      overlay.set({ visible: true, text: text, done: d, total: t, unit: PageSaverI18n.t('ui_530334dbd6c3'), indeterminate: indeterminate });
    }
  }
  function badge(d, t) {
    browser.runtime.sendMessage({ type: 'HTML_BADGE', done: d, total: t }).catch(function () {});
  }

  async function saveAsHtml() {
    const sf = findKernel();
    const overlay = window.joppOverlay;

    if (!sf) {
      // 把现场情况打进控制台，方便定位是「库没执行」还是「挂错地方」
      const kernelErr = window.__pagesaverKernelError || '';
      try {
        console.error(PageSaverI18n.t('ui_337fdce60b63'), {
          kernelError: kernelErr || PageSaverI18n.t('ui_f4b39d9b4542'),
          hasWindowSinglefile: typeof window.singlefile,
          hasGlobalThisSinglefile: typeof globalThis.singlefile,
          readyState: document.readyState
        });
      } catch (e) { /* 忽略 */ }
      const diag = 'w=' + (typeof window.singlefile) + ' g=' + (typeof globalThis.singlefile) +
                   ' err=' + (kernelErr ? kernelErr.slice(0, 80) : 'none');
      try {
        console.error(PageSaverI18n.t('ui_dc1a3a2d194e'), diag,
          { hasWindowSinglefile: typeof window.singlefile, hasGlobalThisSinglefile: typeof globalThis.singlefile });
      } catch (e) { /* 忽略 */ }
      showToast(false, (kernelErr ? PageSaverI18n.t('ui_ab19feec8945') + kernelErr : PageSaverI18n.t('ui_5493c93cf49e')) + '（' + diag + '）');
      return;
    }

    let done = 0;
    let total = 0;

    // 看门狗：任何一个阶段停滞超过 60 秒就主动报错，绝不让进度条无限转圈。
    // （懒加载卡死这类早期 hang 已被后台 lazyTimeout 协议修掉；这是兜底保险。）
    let stallReject = null;
    const watchdog = new Promise(function (_, reject) { stallReject = reject; });
    let lastActivity = Date.now();
    function ping() { lastActivity = Date.now(); }
    const watchdogTimer = setInterval(function () {
      if (Date.now() - lastActivity > 60000 && stallReject) {
        clearInterval(watchdogTimer);
        stallReject(new Error(PageSaverI18n.t('ui_5fcda15706ca') + (total > 0 ? PageSaverI18n.t('ui_1b5cc7f39f38') + done + '/' + total + PageSaverI18n.t('ui_4385285b1ae2') : PageSaverI18n.t('ui_6b6fa6770206')) + PageSaverI18n.t('ui_ac9b988cff68')));
      }
    }, 5000);
    ping();

    prog(PageSaverI18n.t('ui_89d1df657758'), 0, 0, true);
    badge(0, 0);

    // 默认配置对齐 SingleFile 官方 DEFAULT_CONFIG（保证产出效果一致）
    const options = {
      removeHiddenElements: true,
      removedElementsSelector: '',
      removeUnusedStyles: true,
      removeUnusedFonts: true,
      removeUnusedGlyphs: false,
      removeFrames: false,
      compressHTML: true,
      compressContent: false,      // false → content 是明文 HTML 字符串
      loadDeferredContent: true,   // 触发懒加载图片
      loadDeferredContentMaxIdleTime: 1500,
      loadDeferredContentBlockCookies: false,
      loadDeferredContentBlockStorage: false,
      loadDeferredContentKeepZoomLevel: false,
      loadDeferredContentDispatchScrollEvent: true,
      loadDeferredContentBeforeFrames: false,
      loadDeferredContentMinZoomFactor: 0,
      blockScripts: true,
      // ⚠️ 必须 false：很多页面上看到的"动图"其实是 <video autoplay muted loop playsinline>
      // （如 textfold 的 assets/clips/*.mp4，每个都带一张静态 poster 封面）。
      // 置 true 时内核会执行 insertVideoPosters / insertVideoLinks /
      // insertMissingVideoPosters，把视频换成 poster 静态图 → 保存后"动图不动了"。
      blockVideos: false,
      blockAudios: true,
      networkTimeout: 30000,
      maxResourceSize: 10,
      removeAlternativeImages: true,
      removeAlternativeFonts: true,
      groupDuplicateImages: true,
      saveFavicon: true,
      includeBOM: false,
      insertSingleFileComment: true,
      insertCanonicalLink: true,
      insertMetaNoIndex: false,
      saveOriginalURLs: false,
      saveRawPage: false,
      shadowEnabled: true,
      passReferrerOnError: false,
      // 关键修复：把 URL 的 hash 段（如 #download）去掉再传给内核。否则内核会用带 hash
      // 的 options.url 去重新解析/抓取页面，导致存出 #download 那个错误页面的内容。
      // （textfold 页面：正确页是 /textfold/，带 #download 后变成另一个页面。）
      url: (function () {
        try { return location.href.split('#')[0]; } catch (e) { return location.href; }
      })(),
      title: document.title,
      onprogress: async function (event) {
        ping();   // 任何进度事件都刷新看门狗
        const type = event && event.type;
        if (type === 'resources-initialized') {
          total = (event.detail && event.detail.max) || 0;
          prog(PageSaverI18n.t('ui_5b72f94008a6'), 0, total);
          badge(0, total);
        } else if (type === 'resource-loaded') {
          done++;
          if (total > 0) {
            prog(PageSaverI18n.t('ui_5b72f94008a6'), done, total);
            badge(done, total);
          }
        } else if (type === 'page-ended') {
          prog(PageSaverI18n.t('ui_dfec5551f5dc'), done, total || done);
        }
      }
    };

    try {
      // ⚠️ 关键：传给内核初始化函数的参数，会被加工成内核的模块级配置（源码里的 GU）——
      // 压缩 HTML、精简 CSS、剔除未使用字体等 helper 的配置都从那里读。
      // 只传 fetch 钩子的话，这些优化选项一个都不生效，产物会膨胀十几倍
      // （实测：同一页面 59.7MB vs SingleFile 的 10.4MB）。所以必须把完整 options 传进去。
      const initOptions = Object.assign({}, options, { fetch: fetchResource, frameFetch: frameFetch });

      // —— 官方推荐入口：init + getPageData（不是手动 new SingleFile）——
      // 之前手动 `new sf.SingleFile(initOptions)` 只传了一个普通 options（缺 doc/win、
      // 且 root 未设），导致构造函数里 `const a = root && options.doc` 为假、
      // preProcessDoc 整段被跳过，于是 this.options.worklets 永远是 undefined，
      // 走到 processWorklets() 读 worklets.length 直接崩（"can't access property length,
      // this.options.worklets is undefined"）。
      // getPageData 内部会先 `n.doc = globalThis.document; n.win = globalThis;` 再
      // `new SingleFile(n)`，从而正确触发 preProcessDoc、把 worklets 等字段补齐。
      // init() 负责设置模块级配置 GU 并惰性创建 SingleFile 类；fetch/frameFetch 钩子
      // 经 p_() 注入到 GU，处理器据此抓取资源。
      const promoted = promoteLazyMedia();   // 提升 data-src → src，让懒加载的视频/图片能被内联
      // v0.4.11：不把视频预内联进 live DOM（会让内核 finalize 卡死），改成先把视频元素换成
      // 轻量占位 div，等 getPageData 返回最终 HTML 后再在 ensureMediaPlayable 里注入。
      const stashed = stashVideos();
      await sf.init(initOptions);
      const pageData = await Promise.race([sf.getPageData(initOptions), watchdog]);
      clearInterval(watchdogTimer);

      let html = pageData && pageData.content;
      // 极端情况下 content 可能是字节数组（压缩模式），兜底解成字符串
      if (html && typeof html !== 'string') {
        html = new TextDecoder('utf-8').decode(new Uint8Array(html));
      }
      if (!html) throw new Error(PageSaverI18n.t('ui_7c64cb03b08f'));

      // 收尾保险：把占位 div 还原成可播放 <video>（在此才抓 MP4，已脱离内核，不会卡）
      html = await ensureMediaPlayable(html, options.url, prog, ping);

      prog(PageSaverI18n.t('ui_543df68b5f8b'), done, total || done);
      const cleaned = stripOwnUi(html);
      const filename = safeFileName((pageData && pageData.title) || document.title) + PageSaverI18n.t('ui_8e626b043164');

      // Only the background may choose the destination. Never silently download elsewhere.
      let saved = false;
      let detail = '';
      let savedName = filename;
      try {
        const res = await withTimeout(
          browser.runtime.sendMessage({ type: 'HTML_SAVE', html: cleaned, title: (pageData && pageData.title) || document.title }),
          180000, PageSaverI18n.t('ui_e2bc64d8b9d7')
        );
        if (res && res.ok) { saved = true; savedName = res.path || res.filename || filename; }
        else detail = (res && res.error) || PageSaverI18n.t('ui_3461df8deb4d');
      } catch (e) { detail = e.message || PageSaverI18n.t('ui_3461df8deb4d'); }

      if (overlay) overlay.hide();
      badge(-1, -1);
      if (saved) showToast(true, PageSaverI18n.t('ui_e8b7547ba51c') + savedName);
      else showToast(false, PageSaverI18n.t('ui_6ade7baf8737') + (detail || PageSaverI18n.t('ui_13a46616e16f')));
    } catch (e) {
      try { clearInterval(watchdogTimer); } catch (e2) { /* 已清理则忽略 */ }
      if (overlay) overlay.hide();
      badge(-1, -1);
      showToast(false, PageSaverI18n.t('ui_6b57377ccb3e') + (e && e.message ? e.message : String(e)));
    }
  }

  // 把当前网页正文转成 Markdown 并下载（v0.4.14 新增第三项能力）。
  // 复用 obsidian-clipper 的 Defuddle（MIT/Apache-2.0 双许可，可商用）：
  //   1) window.Defuddle.default 是 Defuddle 类（lib/defuddle-full.js 通过 UMD 挂到 window）；
  //   2) window.createMarkdownContent(html, url) 把 Defuddle 提取出的正文 HTML
  //      用 Turndown 转成 Markdown。二者都是 defuddle/full 子包的导出。
  //   （content script 沙箱里 window 与 globalThis 不是同一对象，故和
  //    findKernel() 一样把所有可能的挂载点都找一遍，避免环境差异绊倒。）
  function findDefuddle() {
    const roots = [];
    const push = function (o) { if (o && roots.indexOf(o) < 0) roots.push(o); };
    try { push(window); } catch (e) {}
    try { push(globalThis); } catch (e) {}
    try { push(self); } catch (e) {}
    try { push(document.defaultView); } catch (e) {}
    try { if (document.defaultView && document.defaultView.top) push(document.defaultView.top); } catch (e) {}
    for (let i = 0; i < roots.length; i++) {
      const mod = roots[i].Defuddle;
      // Defuddle 包把类本身作为函数导出，createMarkdownContent 挂在函数属性上
      if (mod && typeof mod === 'function' && typeof mod.createMarkdownContent === 'function') {
        return { Defuddle: mod, createMarkdownContent: mod.createMarkdownContent };
      }
    }
    return null;
  }

  async function saveAsMarkdown() {
    const overlay = window.joppOverlay;
    const def = findDefuddle();
    if (!def || typeof def.createMarkdownContent !== 'function') {
      showToast(false, PageSaverI18n.t('ui_797e76222eb3'));
      if (overlay) overlay.hide();
      return;
    }

    try {
      prog && prog(PageSaverI18n.t('ui_36319fedcc83'), 0, 1);
      // Defuddle 从页面原始 HTML 里抽取正文（自动去掉导航/页脚/广告块），
      // 再交给 createMarkdownContent 转 Markdown。给整轮加超时，卡死就降级报错。
      const result = await withTimeout(
        new def.Defuddle(document, { url: location.href, standardize: true }).parse(),
        60000,
        PageSaverI18n.t('ui_bcce2b50846c')
      );

      // Defuddle.content 是正文 HTML；转 Markdown。
      let md = '';
      try {
        md = def.createMarkdownContent(result.content, location.href);
      } catch (e) {
        md = '';
      }

      prog && prog(PageSaverI18n.t('ui_543df68b5f8b'), 1, 1);
      const title = (result && result.title) || document.title || 'page';
      const filename = safeFileName(title) + '.md';

      let saved = false, handedOff = false;
      let detail = '';
      let savedName = filename;
      try {
        const res = await withTimeout(
          browser.runtime.sendMessage({ type: 'MARKDOWN_SAVE', markdown: md, title }),
          180000, PageSaverI18n.t('ui_e2bc64d8b9d7')
        );
        if (res && res.ok) { saved = true; handedOff = !!res.handedOff; savedName = res.path || res.filename || filename; }
        else detail = (res && res.error) || PageSaverI18n.t('ui_3461df8deb4d');
      } catch (e) { detail = e.message || PageSaverI18n.t('ui_3461df8deb4d'); }

      if (overlay) overlay.hide();
      badge(-1, -1);
      if (saved) showToast(true, handedOff ? PageSaverI18n.t('ui_0af815f36da7') : PageSaverI18n.t('ui_7020562a62b2') + savedName);
      else showToast(false, PageSaverI18n.t('ui_121647ff38b4') + (detail || PageSaverI18n.t('ui_13a46616e16f')));
    } catch (e) {
      if (overlay) overlay.hide();
      badge(-1, -1);
      showToast(false, PageSaverI18n.t('ui_121647ff38b4') + (e && e.message ? e.message : String(e)));
    }
  }

  browser.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === 'HTML_RUN') {
      setTimeout(saveAsHtml, 0);   // 立即应答，不让触发方干等
      sendResponse({ ok: true });
      return false;
    }
    if (msg && msg.type === 'MARKDOWN_RUN') {
      console.log(PageSaverI18n.t('ui_629a187dd146'), location.href);
      setTimeout(saveAsMarkdown, 0); // 立即应答，不让触发方干等
      sendResponse({ ok: true });
      return false;
    }
    if (msg && msg.type === 'PDF_RUN') {
      browser.runtime.sendMessage({ type: 'CAPTURE_PAGE_PDF' }).catch(function () {});
      sendResponse({ ok: true });
      return false;
    }
    return undefined;
  });
})();
