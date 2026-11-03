// M1.5 · 元素/区域选取器（Picker）
// 复刻原插件 Just-One-Page-PDF 的招牌交互：
//   Node 模式：鼠标悬停 → 红框套住命中的「框架」→ 滚轮/按键沿祖先链换层 → 点一下确认
//   Area 模式：按住拖出一个矩形 → 确认
// 确认后只渲染选中的内容（html-to-image），左右/顶部的 fixed 悬浮件是「兄弟节点」，
// 根本不在被渲染的子树里，所以天然不会出现原插件那种浮层干扰。
(function () {
  if (window.__joppPickerReady) return;
  window.__joppPickerReady = true;

  // 动态读取：顶层快照会把「加载顺序不对」永久锁死成 undefined
  function h2i() { return window.htmlToImage; }

  const MARK = 'data-jopp-picker-ui';   // 标记我们自己的 UI 节点，命中时忽略
  const MIN_BLOCK_W = 120;              // 启发式：多宽才算「框架」而不是一行文字
  const MIN_BLOCK_H = 48;
  const MIN_AREA = 8;                   // 框选小于这个尺寸视为误点
  const MAX_PIXELS = 16e6;              // 超过这个像素量就降采样，保住内存
  const DPR = Math.min(2, window.devicePixelRatio || 1);

  let mode = null;        // 'node' | 'area'
  let chain = [];         // 祖先链，index 0 = 最内层命中元素
  let idx = 0;            // 当前选中的层
  let areaStart = null;   // {x, y} 起点（视口坐标）
  let areaRect = null;    // {x, y, w, h} 选区（视口坐标）
  let dragging = false;
  let ui = null;

  // ---------------------------------------------------------------- 工具

  function ratioFor(w, h) {
    return (w * h * DPR * DPR > MAX_PIXELS) ? 1 : DPR;
  }

  // 只判断「我们自己 UI 上的按钮」：
  // · Area 模式的全屏捕获层(div)必须能正常收到 mousedown，否则拖不出框；
  // · 但确认按钮上的 mousedown 又不能把选区清空（否则点按钮确认会毫无反应）。
  function isOurButton(node) {
    return !!(node && node.closest && node.closest('[' + MARK + '] button'));
  }

  // 任何"我们自己的 UI 节点"（含 Area 模式那层全屏捕获层这种 div）
  function isOurUi(node) {
    return !!(node && node.closest && node.closest('[' + MARK + ']'));
  }

  // 元素的「人类可读路径」，例如 div.content > article#main
  function describe(el) {
    if (!el) return '';
    const parts = [];
    let n = el;
    for (let i = 0; n && n.nodeType === 1 && i < 4; i++) {
      let s = n.tagName.toLowerCase();
      if (n.id) { s += '#' + n.id; parts.unshift(s); break; }
      if (n.className && typeof n.className === 'string') {
        const cls = n.className.trim().split(/\s+/).filter(Boolean)[0];
        if (cls) s += '.' + cls;
      }
      parts.unshift(s);
      n = n.parentElement;
    }
    return parts.join(' > ');
  }

  // ---------------------------------------------------------------- UI 层

  function buildUI() {
    if (ui) return ui;
    const root = document.createElement('div');
    root.setAttribute(MARK, '1');
    root.style.cssText =
      'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483647;' +
      'pointer-events:none;font:13px/1.5 system-ui,-apple-system,sans-serif;';

    // 四块暗罩（Area 模式用，把选区之外压暗）
    const shades = ['top', 'right', 'bottom', 'left'].map(function (side) {
      const d = document.createElement('div');
      d.setAttribute(MARK, '1');
      d.style.cssText = 'position:absolute;display:none;background:rgba(0,0,0,0.35);pointer-events:none;';
      root.appendChild(d);
      return d;
    });

    // Node 模式的红框（对应原插件 ctre_marked_overlay：红虚线 + 半透明红填充）
    const box = document.createElement('div');
    box.className = 'jopp-node-box';
    box.setAttribute(MARK, '1');
    box.style.cssText =
      'position:absolute;display:none;border:2px dashed #ff4d4f;background:rgba(255,77,79,0.16);' +
      'box-shadow:0 0 0 9999px rgba(0,0,0,0.06);pointer-events:none;box-sizing:border-box;';
    root.appendChild(box);

    // Area 模式的选区框
    const areaBox = document.createElement('div');
    areaBox.className = 'jopp-area-box';
    areaBox.setAttribute(MARK, '1');
    areaBox.style.cssText =
      'position:absolute;display:none;border:2px dashed #ff4d4f;background:rgba(255,77,79,0.12);' +
      'pointer-events:none;box-sizing:border-box;';
    root.appendChild(areaBox);

    // 跟随红框的标签（尺寸 + 路径）
    const label = document.createElement('div');
    label.className = 'jopp-label';
    label.setAttribute(MARK, '1');
    label.style.cssText =
      'position:absolute;display:none;max-width:420px;padding:2px 6px;background:#ff4d4f;color:#fff;' +
      'font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none;';
    root.appendChild(label);

    // 底部提示条
    const hint = document.createElement('div');
    hint.setAttribute(MARK, '1');
    hint.style.cssText =
      'position:absolute;left:50%;bottom:24px;transform:translateX(-50%);padding:8px 14px;' +
      'background:rgba(0,0,0,0.82);color:#fff;border-radius:8px;font-size:13px;pointer-events:none;';
    root.appendChild(hint);

    // Area 模式的确认按钮
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'jopp-confirm';
    confirmBtn.setAttribute(MARK, '1');
    confirmBtn.textContent = PageSaverI18n.t('ui_97f5b973a4c9');
    confirmBtn.style.cssText =
      'position:absolute;display:none;padding:6px 12px;background:#ff4d4f;color:#fff;border:none;' +
      'border-radius:6px;font-size:13px;cursor:pointer;pointer-events:auto;';
    confirmBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      confirmArea();
    });
    root.appendChild(confirmBtn);

    // Area 模式的透明捕获层（接管鼠标事件，避免页面自己抢走）
    const shield = document.createElement('div');
    shield.className = 'jopp-shield';
    shield.setAttribute(MARK, '1');
    shield.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:none;pointer-events:auto;cursor:crosshair;';
    root.appendChild(shield);

    (document.documentElement || document.body).appendChild(root);
    ui = { root: root, box: box, areaBox: areaBox, label: label, hint: hint, shades: shades, confirmBtn: confirmBtn, shield: shield };
    return ui;
  }

  function destroyUI() {
    if (ui && ui.root && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
    ui = null;
  }

  // ---------------------------------------------------------------- Node 模式

  function buildChain(target) {
    const list = [];
    let n = target;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      list.push(n);
      n = n.parentElement;
    }
    chain = list;
    idx = defaultIndex(list);
  }

  // 默认落在第一个「像个框架」的祖先上（够宽、够高、不是 inline），
  // 否则用户悬停到一行文字时红框会细得没法用。原插件是手动爬层，我们给了个温和的起点。
  function defaultIndex(list) {
    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      const r = el.getBoundingClientRect();
      if (r.width >= MIN_BLOCK_W && r.height >= MIN_BLOCK_H) {
        const cs = getComputedStyle(el);
        if (cs.display !== 'inline' && cs.display !== 'none') return i;
      }
    }
    return 0;
  }

  // 把标签放到 (x, y)（文档坐标）；贴着右边/下边时自动拉回视口内，避免跑出屏幕看不见
  function placeLabel(x, y) {
    ui.label.style.left = x + 'px';
    ui.label.style.top = y + 'px';
    const w = ui.label.offsetWidth || 0;
    const h = ui.label.offsetHeight || 0;
    const viewLeft = window.scrollX;
    const viewTop = window.scrollY;
    const maxX = viewLeft + window.innerWidth - w - 8;
    const maxY = viewTop + window.innerHeight - h - 8;
    const left = Math.min(Math.max(viewLeft + 8, x), Math.max(viewLeft + 8, maxX));
    const top = Math.min(Math.max(viewTop + 4, y), Math.max(viewTop + 4, maxY));
    ui.label.style.left = left + 'px';
    ui.label.style.top = top + 'px';
  }

  function drawNodeBox() {
    if (mode !== 'node' || !chain.length) return;
    const el = chain[idx];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const sx = window.scrollX;
    const sy = window.scrollY;

    ui.box.style.display = 'block';
    ui.box.style.left = (r.left + sx) + 'px';
    ui.box.style.top = (r.top + sy) + 'px';
    ui.box.style.width = r.width + 'px';
    ui.box.style.height = r.height + 'px';

    // 只显示尺寸：选择器路径、层数这些对"确认这一刻"没用，反而挡视线。
    // 换层提示已经在底部提示条里写了（滚轮 / Q W / ↑↓）。
    ui.label.textContent = Math.round(r.width) + ' × ' + Math.round(r.height) + ' px';
    ui.label.style.display = 'block';
    placeLabel(r.left + sx, Math.max(0, (r.top + sy) - 20));
  }

  function onMove(e) {
    if (mode !== 'node') return;
    const t = e.target;
    if (isOurButton(t)) return;
    if (!t || t.nodeType !== 1) return;
    buildChain(t);
    drawNodeBox();
  }

  function onWheel(e) {
    if (mode !== 'node' || !chain.length) return;
    // Shift+滚轮 = 放行给页面（长页面里要能往下滚）
    if (e.shiftKey) return;
    e.preventDefault();
    // 向上滚 = 往外（父容器），向下滚 = 往里（子元素）
    idx = e.deltaY < 0 ? Math.min(idx + 1, chain.length - 1) : Math.max(idx - 1, 0);
    drawNodeBox();
  }

  function onKey(e) {
    if (mode === 'node') {
      if (e.key === 'Escape') { teardown(); return; }
      if (e.key === 'Enter') { confirmNode(); return; }
      if ((e.key === 'q' || e.key === 'Q' || e.key === 'ArrowUp') && chain.length) {
        e.preventDefault();
        idx = Math.min(idx + 1, chain.length - 1);
        drawNodeBox();
        return;
      }
      if ((e.key === 'w' || e.key === 'W' || e.key === 'ArrowDown') && chain.length) {
        e.preventDefault();
        idx = Math.max(idx - 1, 0);
        drawNodeBox();
        return;
      }
    } else if (mode === 'area') {
      if (e.key === 'Escape') { teardown(); return; }
      if (e.key === 'Enter' && areaRect && areaRect.w >= MIN_AREA) { confirmArea(); return; }
    }
    e.preventDefault();
    e.stopPropagation();
  }

  // ---------------------------------------------------------------- Area 模式

  function drawArea() {
    if (mode !== 'area' || !areaRect) return;
    const r = areaRect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    ui.areaBox.style.display = 'block';
    ui.areaBox.style.left = r.x + 'px';
    ui.areaBox.style.top = r.y + 'px';
    ui.areaBox.style.width = r.w + 'px';
    ui.areaBox.style.height = r.h + 'px';

    const s = ui.shades;
    s[0].style.display = 'block'; s[0].style.left = '0px'; s[0].style.top = '0px';
    s[0].style.width = vw + 'px'; s[0].style.height = r.y + 'px';
    s[1].style.display = 'block'; s[1].style.left = (r.x + r.w) + 'px'; s[1].style.top = '0px';
    s[1].style.width = Math.max(0, vw - r.x - r.w) + 'px'; s[1].style.height = vh + 'px';
    s[2].style.display = 'block'; s[2].style.left = '0px'; s[2].style.top = (r.y + r.h) + 'px';
    s[2].style.width = vw + 'px'; s[2].style.height = Math.max(0, vh - r.y - r.h) + 'px';
    s[3].style.display = 'block'; s[3].style.left = '0px'; s[3].style.top = r.y + 'px';
    s[3].style.width = r.x + 'px'; s[3].style.height = r.h + 'px';

    ui.label.textContent = Math.round(r.w) + ' × ' + Math.round(r.h) + PageSaverI18n.t('ui_366c4cbc6d5f');
    ui.label.style.display = 'block';
    placeLabel(r.x, Math.max(0, r.y - 22));

    ui.confirmBtn.style.display = 'block';
    ui.confirmBtn.style.left = Math.round(r.x + r.w / 2 - 50) + 'px';
    ui.confirmBtn.style.top = Math.round(r.y + r.h + 10) + 'px';
  }

  function onAreaDown(e) {
    if (mode !== 'area') return;
    // 点的是我们自己的 UI（比如「截取此区域」按钮）时，不能把选区清掉，
    // 否则按钮的 mousedown 会抢先重置选区，导致后续 click 确认时选区已空
    if (isOurButton(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    areaStart = { x: e.clientX, y: e.clientY };
    areaRect = { x: e.clientX, y: e.clientY, w: 0, h: 0 };
    dragging = true;
    drawArea();
  }

  function onAreaMove(e) {
    if (mode !== 'area' || !dragging) return;
    if (isOurButton(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    areaRect = {
      x: Math.min(e.clientX, areaStart.x),
      y: Math.min(e.clientY, areaStart.y),
      w: Math.abs(e.clientX - areaStart.x),
      h: Math.abs(e.clientY - areaStart.y)
    };
    drawArea();
  }

  function onAreaUp(e) {
    if (mode !== 'area' || !dragging) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = false;
    if (!areaRect || areaRect.w < MIN_AREA || areaRect.h < MIN_AREA) {
      teardown();
      return;
    }
    drawArea();
  }

  // 找一个能罩住整个选区的最小祖先元素——用它当渲染目标，内存比渲染整页小得多
  function findCommonAncestor(r) {
    const pts = [
      [r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]
    ];
    let el = null;
    try { el = document.elementFromPoint(pts[0][0], pts[0][1]); } catch (e) { el = null; }
    if (!el || isOurUi(el)) el = document.body;
    while (el && el !== document.documentElement) {
      const b = el.getBoundingClientRect();
      const inside = pts.every(function (p) {
        return p[0] >= b.left - 1 && p[0] <= b.right + 1 && p[1] >= b.top - 1 && p[1] <= b.bottom + 1;
      });
      if (inside) return el;
      el = el.parentElement;
    }
    return document.documentElement;
  }

  // ---------------------------------------------------------------- 截图

  // 渲染时排除：我们的 UI、fixed/sticky 浮层（目标内部的粘性表头之类）
  function makeFilter(root) {
    return function (node) {
      if (!node || node.nodeType !== 1) return true;
      if (node === root) return true;
      if (node.getAttribute && node.getAttribute(MARK)) return false;
      const cs = getComputedStyle(node);
      if (cs && (cs.position === 'fixed' || cs.position === 'sticky')) return false;
      return true;
    };
  }

  async function confirmNode() {
    const el = chain[idx];
    if (!el) return;
    if (!h2i() || !h2i().toCanvas) { showLibError(); return; }
    const rect = el.getBoundingClientRect();
    const w = Math.max(el.offsetWidth || 0, el.scrollWidth || 0, rect.width || 0);
    const h = Math.max(el.offsetHeight || 0, el.scrollHeight || 0, rect.height || 0);
    if (w < 2 || h < 2) return;

    // 只把"要哪一块"告诉后台，由后台用浏览器原生截图去截。
    // 这样完全绕开网站 CSP 和跨域限制（html-to-image 在这两类站点上必然失败）。
    const docRect = {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      w: Math.round(w),
      h: Math.round(h)
    };
    teardown();
    captureRectToPdf(docRect, describe(el), 'node');
  }

  async function confirmArea() {
    if (!areaRect || areaRect.w < MIN_AREA || areaRect.h < MIN_AREA) return;
    const docRect = {
      x: Math.round(areaRect.x + window.scrollX),
      y: Math.round(areaRect.y + window.scrollY),
      w: Math.round(areaRect.w),
      h: Math.round(areaRect.h)
    };
    teardown();
    captureRectToPdf(docRect, PageSaverI18n.t('ui_31d09fc9102e'), 'area');
  }

  // 交给后台：原生截图 + 裁剪 + 合成单页 PDF
  async function captureRectToPdf(docRect, label, mode) {
    // 先用统一的"全屏置灰 + 进度条"遮住页面（后台会接着更新进度，结束时自己撤掉）
    if (window.joppOverlay) {
      window.joppOverlay.set({ visible: true, text: PageSaverI18n.t('ui_a5f64cb282fe'), indeterminate: true });
    }
    try {
      const res = await browser.runtime.sendMessage({
        type: 'CAPTURE_RECT_PDF',
        rect: docRect,
        title: document.title
      });
      if (!res || !res.ok) {
        if (window.joppOverlay) window.joppOverlay.set({ visible: false });
        showError(new Error((res && res.error) || PageSaverI18n.t('ui_13a46616e16f')));
        return;
      }
      showResult({
        dataUrl: res.preview,
        width: res.width,
        height: res.height,
        label: label,
        mode: mode,
        savedPdf: res.filename,
        textCount: res.textCount || 0,
        screens: res.screens || 1,
        scrolled: !!res.scrolled
      });
    } catch (e) {
      if (window.joppOverlay) window.joppOverlay.set({ visible: false });
      showError(e);
    }
  }

  // ---------------------------------------------------------------- 结果展示

  // 库没挂上时，把启动期捕获到的真实报错带出来
  function showLibError() {
    var boot = (window.__joppBootErrors || []).join('；');
    showError(new Error(PageSaverI18n.t('ui_a1791229b274') + (boot ? PageSaverI18n.t('ui_93a11c9ada3c') + boot + '）' : PageSaverI18n.t('ui_cc7c29ed42be'))));
  }

  function showError(err) {
    const root = document.createElement('div');
    root.setAttribute(MARK, '1');
    root.style.cssText =
      'position:fixed;left:50%;top:24px;transform:translateX(-50%);z-index:2147483647;' +
      'padding:10px 14px;background:#b3261e;color:#fff;border-radius:8px;font:13px/1.5 system-ui,sans-serif;';
    root.textContent = PageSaverI18n.t('ui_b14c0e5aa352') + String(err && err.message ? err.message : err);
    (document.body || document.documentElement).appendChild(root);
    setTimeout(function () {
      if (root.parentNode) root.parentNode.removeChild(root);
    }, 6000);
  }

  function showResult(res) {
    const root = document.createElement('div');
    root.className = 'jopp-result';
    root.setAttribute(MARK, '1');
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:rgba(15,15,18,0.9);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:28px;' +
      'box-sizing:border-box;font:13px/1.5 system-ui,-apple-system,sans-serif;color:#fff;';

    const head = document.createElement('div');
    head.style.cssText = 'font-size:14px;';
    head.textContent = PageSaverI18n.t('ui_e469d7ff70dd') + res.width + ' × ' + res.height + ' px　·　' + res.label +
      (res.mode === 'node' ? PageSaverI18n.t('ui_a9814b532dad') : PageSaverI18n.t('ui_c4fd663e126d'));
    root.appendChild(head);

    const img = document.createElement('img');
    img.className = 'jopp-result-img';
    img.src = res.dataUrl;
    img.style.cssText = 'max-width:90vw;max-height:64vh;background:#fff;border:1px solid #3a3a40;object-fit:contain;';
    root.appendChild(img);

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:10px;flex-wrap:wrap;justify-content:center;';

    // PDF 已经在后台生成并下载好了，这里只负责展示结果
    const okLine = document.createElement('div');
    okLine.style.cssText = 'color:#7ee787;font-size:13px;text-align:center;max-width:660px;';
    okLine.textContent = res.savedPdf
      ? (PageSaverI18n.t('ui_b925e724dab6') + res.savedPdf +
         (res.textCount > 0 ? PageSaverI18n.t('ui_1ccd840ca8db') + res.textCount + PageSaverI18n.t('ui_0e12850bb95d') : ''))
      : PageSaverI18n.t('ui_5aa2555f06fa');
    root.appendChild(okLine);

    const note = document.createElement('div');
    note.style.cssText = 'font-size:12px;color:#ffb4b4;max-width:640px;text-align:center;';

    const dl = document.createElement('button');
    dl.textContent = PageSaverI18n.t('ui_89d72e71bfa0');
    dl.style.cssText = btnStyle('#3a3a40');
    dl.addEventListener('click', function () {
      const a = document.createElement('a');
      a.href = res.dataUrl;
      const base = (document.title || 'page').replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || 'page';
      a.download = base + PageSaverI18n.t('ui_c90d30aca0ed');
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    const close = document.createElement('button');
    close.textContent = PageSaverI18n.t('ui_3fd47edce45b');
    close.style.cssText = btnStyle('#3a3a40');
    close.addEventListener('click', function () {
      if (root.parentNode) root.parentNode.removeChild(root);
    });

    bar.appendChild(dl);
    bar.appendChild(close);
    root.appendChild(bar);
    root.appendChild(note);

    (document.body || document.documentElement).appendChild(root);

    try {
      browser.runtime.sendMessage({
        type: 'PICKER_DONE',
        payload: { mode: res.mode, width: res.width, height: res.height, label: res.label }
      });
    } catch (e) { /* 后台不在也不影响结果展示 */ }
  }

  function btnStyle(bg) {
    return 'padding:7px 14px;background:' + bg + ';color:#fff;border:none;border-radius:6px;' +
      'font-size:13px;cursor:pointer;';
  }

  // ---------------------------------------------------------------- 生命周期

  function start(which) {
    teardown();
    mode = which;
    chain = [];
    idx = 0;
    areaStart = null;
    areaRect = null;
    dragging = false;

    lockSelection();
    buildUI();

    if (mode === 'node') {
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('wheel', onWheel, { capture: true, passive: false });
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('mousedown', onNodeDown, true);
      window.addEventListener('scroll', onScroll, true);
      ui.hint.textContent = PageSaverI18n.t('ui_87e7b5f5db19');
    } else {
      ui.shield.style.display = 'block';
      document.addEventListener('mousedown', onAreaDown, true);
      document.addEventListener('mousemove', onAreaMove, true);
      document.addEventListener('mouseup', onAreaUp, true);
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('wheel', onAreaWheel, { capture: true, passive: false });
      ui.hint.textContent = PageSaverI18n.t('ui_3e63181a4dca');
    }
    ui.hint.style.display = 'block';
  }

  function onAreaWheel(e) {
    // Area 模式默认拦住滚动（拖框时要页面静止），Shift+滚轮 放行
    if (mode === 'area' && !e.shiftKey) e.preventDefault();
  }

  function onNodeDown(e) {
    if (mode !== 'node') return;
    // 同理：点在结果浮层的按钮上时不要触发确认
    if (isOurButton(e.target)) return;
    // 单击即确认：这里吃掉事件，避免误触发页面里的链接跳转
    e.preventDefault();
    e.stopPropagation();
    confirmNode();
  }

  function onScroll() {
    if (mode === 'node') drawNodeBox();
  }

  // 选区模式期间禁止页面文本被选中：拖动鼠标扫过文字时不会留下高亮痕迹
  let savedUserSelect = null;
  function lockSelection() {
    const de = document.documentElement;
    if (!de || savedUserSelect) return;
    savedUserSelect = {
      prev: de.style.getPropertyValue('user-select'),
      prio: de.style.getPropertyPriority('user-select'),
      mprev: de.style.getPropertyValue('-moz-user-select'),
      mprio: de.style.getPropertyPriority('-moz-user-select')
    };
    de.style.setProperty('user-select', 'none', 'important');
    de.style.setProperty('-moz-user-select', 'none', 'important');
  }
  function unlockSelection() {
    const de = document.documentElement;
    if (!de || !savedUserSelect) return;
    const v = savedUserSelect;
    savedUserSelect = null;
    if (v.prev) de.style.setProperty('user-select', v.prev, v.prio || '');
    else de.style.removeProperty('user-select');
    if (v.mprev) de.style.setProperty('-moz-user-select', v.mprev, v.mprio || '');
    else de.style.removeProperty('-moz-user-select');
  }

  function teardown() {
    unlockSelection();
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('wheel', onWheel, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('mousedown', onNodeDown, true);
    document.removeEventListener('mousedown', onAreaDown, true);
    document.removeEventListener('mousemove', onAreaMove, true);
    document.removeEventListener('mouseup', onAreaUp, true);
    document.removeEventListener('wheel', onAreaWheel, true);
    window.removeEventListener('scroll', onScroll, true);
    destroyUI();
    mode = null;
    chain = [];
    idx = 0;
    areaRect = null;
    dragging = false;
  }

  browser.runtime.onMessage.addListener(function (msg) {
    if (!msg) return false;
    if (msg.type === 'PICKER_START') {
      start(msg.mode === 'area' ? 'area' : 'node');
      return true;
    }
    if (msg.type === 'PICKER_CANCEL') {
      teardown();
      return true;
    }
    return false;
  });
})();
