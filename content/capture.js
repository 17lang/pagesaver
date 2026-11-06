// 整页截图（路线 A）：用 html-to-image 把整页渲染成一张画布。
// 这张图的宽高比 = 原页真实宽高比，M2 会把它原样铺进「一张」PDF 页（即一页长图）。
//
// 渲染统一走 window.joppRender.toCanvas —— 它带"失败自动降级重试"（去掉 iframe/video/canvas、不嵌字体再试一次），
// 因为页面里常有跨域图片/iframe 会让 html-to-image 直接抛错（它抛的是 Event 对象，不是 Error）。
(function () {
  if (window.joppNativeCapture) return;
  const MARK = 'data-jopp-picker-ui';   // 扩展自己的 UI 节点标记（隐藏浮层时要跳过它们）

  // 量出整页完整尺寸（含滚动溢出部分）
  function measurePage() {
    const de = document.documentElement;
    const body = document.body;
    const width = Math.max(
      body.scrollWidth, de.scrollWidth,
      body.offsetWidth, de.offsetWidth,
      body.clientWidth, de.clientWidth
    );
    const height = Math.max(
      body.scrollHeight, de.scrollHeight,
      body.offsetHeight, de.offsetHeight,
      body.clientHeight, de.clientHeight
    );
    return { width, height };
  }

  function errText(e) {
    try {
      return window.joppRender.describeError(e);
    } catch (x) {
      return String(e && e.message ? e.message : e);
    }
  }

  // 整页 → 画布
  async function captureFullPageCanvas() {
    const { width, height } = measurePage();
    // 先滚回顶部，保证渲染起点一致
    window.scrollTo(0, 0);
    const canvas = await window.joppRender.toCanvas(document.documentElement, {
      width: width,
      height: height,
      skipFonts: false
    });
    return { canvas: canvas, width: width, height: height };
  }

  // 整页 → PNG dataURL（给 popup 预览用）
  async function captureFullPage() {
    const r = await captureFullPageCanvas();
    return { dataUrl: r.canvas.toDataURL('image/png'), width: r.width, height: r.height };
  }

  // ---------- 原生截图路线：滚动前的准备 / 滚动 / 还原 ----------
  //
  // 截图前把所有 position:fixed / sticky 的元素藏起来（用 visibility:hidden，不改变布局），
  // 这样逐屏截图拼接时才不会出现"悬浮物重复出现"的重影。
  let hiddenForCapture = null;
  let savedScroll = null;
  let savedScrollBehavior = null;

  // 有些站点给 html/body 设了 scroll-behavior:smooth，那样 window.scrollTo() 会变成
  // 一段平滑滚动动画 —— 用户就会看到页面在"滚"。截图期间强制改成 auto（瞬时跳转）。
  function lockScrollBehavior() {
    savedScrollBehavior = [];
    [document.documentElement, document.body].forEach(function (el) {
      if (!el) return;
      savedScrollBehavior.push({
        el: el,
        prev: el.style.getPropertyValue('scroll-behavior'),
        prio: el.style.getPropertyPriority('scroll-behavior')
      });
      el.style.setProperty('scroll-behavior', 'auto', 'important');
    });
  }

  function unlockScrollBehavior() {
    if (!savedScrollBehavior) return;
    savedScrollBehavior.forEach(function (s) {
      if (s.prev) s.el.style.setProperty('scroll-behavior', s.prev, s.prio || '');
      else s.el.style.removeProperty('scroll-behavior');
    });
    savedScrollBehavior = null;
  }

  // 隐藏所有 fixed / sticky 元素（用 visibility，不改布局），避免拼接时浮层重影。
  // 进度遮罩由后台控制显隐；保存提示等其他浮层也必须藏起来，避免进入 PDF。
  function capPrepare() {
    savedScroll = { x: window.scrollX, y: window.scrollY };
    lockScrollBehavior();

    const hidden = [];
    let all;
    try { all = document.querySelectorAll('body *'); } catch (e) { all = []; }
    const limit = Math.min(all.length, 12000); // 超大页面给个上限，避免卡死

    for (let i = 0; i < limit; i++) {
      const el = all[i];
      if (el.closest && el.closest('[data-jopp-overlay="1"]')) continue;
      let cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs && (cs.position === 'fixed' || cs.position === 'sticky')) {
        hidden.push({ el: el, prev: el.style.getPropertyValue('visibility'), prio: el.style.getPropertyPriority('visibility') });
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
    hiddenForCapture = hidden;

    const de = document.documentElement;
    const body = document.body;
    return {
      ok: true,
      width: Math.max(body.scrollWidth, de.scrollWidth, body.offsetWidth, de.offsetWidth),
      height: Math.max(body.scrollHeight, de.scrollHeight, body.offsetHeight, de.offsetHeight),
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      hiddenCount: hidden.length,
      fullFrameUrl: Array.from(document.querySelectorAll('iframe')).filter(function (el) {
        const r = el.getBoundingClientRect();
        return r.x >= -2 && r.y >= -2 && r.x <= 2 && r.y <= 2 &&
          r.width >= innerWidth - 4 && r.height >= innerHeight - 4;
      }).map(function (el) { return el.src; })[0] || null
    };
  }

  function capScrollTo(y) {
    // behavior:'instant' 双保险：即使 CSS 里有 smooth，也不做动画
    window.scrollTo({ left: 0, top: Math.max(0, y || 0), behavior: 'instant' });
    // 报告实际滚动位置：页面到底时浏览器会截断，用真实值拼接才不错位
    return { y: window.scrollY, x: window.scrollX };
  }

  function capRestore() {
    if (hiddenForCapture) {
      hiddenForCapture.forEach(function (h) {
        if (h.prev) h.el.style.setProperty('visibility', h.prev, h.prio || '');
        else h.el.style.removeProperty('visibility');
      });
      hiddenForCapture = null;
    }
    // 回到用户原来的位置（不是粗暴回顶部 —— 那本身也是一次滚动）
    if (savedScroll) {
      window.scrollTo({ left: savedScroll.x || 0, top: savedScroll.y || 0, behavior: 'instant' });
      savedScroll = null;
    }
    unlockScrollBehavior();
    return { ok: true };
  }

  window.joppNativeCapture = { prepare: capPrepare, scrollTo: capScrollTo, restore: capRestore };

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // 统一的"全屏置灰 + 进度条"遮罩（截图瞬间会被临时隐藏，避免被拍进 PDF）
    if (msg && msg.type === 'CAP_OVERLAY') {
      try {
        if (!window.joppOverlay) {
          sendResponse({ ok: false, error: PageSaverI18n.t('ui_3ee0addfb74a') });
        } else if (msg.hide) {
          window.joppOverlay.hide();
          sendResponse({ ok: true });
        } else if (msg.visible === false) {
          window.joppOverlay.set({ visible: false });
          sendResponse({ ok: true });
        } else {
          window.joppOverlay.set({
            // 注意：传 undefined 表示"只更新进度、不改显隐"（拍照时遮罩必须是隐藏的）
            visible: msg.visible,
            text: msg.text,
            done: msg.done,
            total: msg.total,
            indeterminate: msg.indeterminate
          });
          sendResponse({ ok: true });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
      return false;
    }

    // 文字层：采集每行文字的内容/坐标/字号（供 PDF 叠透明文字，让 PDF 可搜索）
    if (msg && msg.type === 'CAP_TEXT_LAYER') {
      try {
        const rects = window.joppTextLayer.collect(null, msg.rect || null);
        sendResponse({ ok: true, rects: rects });
      } catch (e) {
        sendResponse({ ok: false, error: String(e && e.message ? e.message : e) });
      }
      return false;
    }

    if (msg && msg.type === 'CAP_PREPARE') {
      try { sendResponse(capPrepare()); }
      catch (e) { sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }); }
      return false;
    }
    if (msg && msg.type === 'CAP_SCROLL_TO') {
      try { sendResponse(capScrollTo(msg.y || 0)); }
      catch (e) { sendResponse({ y: msg.y || 0 }); }
      return false;
    }
    if (msg && msg.type === 'CAP_RESTORE') {
      try { sendResponse(capRestore()); }
      catch (e) { sendResponse({ ok: false }); }
      return false;
    }

    if (msg && msg.type === 'CAPTURE_FULL_PAGE') {
      captureFullPage()
        .then((res) => sendResponse({ ok: true, dataUrl: res.dataUrl, width: res.width, height: res.height }))
        .catch((err) => sendResponse({ ok: false, error: errText(err) }));
      return true; // 表示将异步调用 sendResponse
    }

    // M2：整页直接出单页 PDF
    if (msg && msg.type === 'CAPTURE_FULL_PAGE_PDF') {
      captureFullPageCanvas()
        .then((r) => window.joppPdf.canvasToPdf(r.canvas, { width: r.width, height: r.height }, document.title))
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ ok: false, error: errText(err) }));
      return true;
    }
    return false;
  });
})();
