// 全屏遮罩 + 进度条：所有截图/合成过程统一用它，避免用户看到页面在滚动。
//
// 为什么必须能在"截图瞬间"隐藏：浏览器原生截图拍的是屏幕像素，
// 遮罩如果一直显示，就会被拍进 PDF 里。所以这里用 visibility 开关（不重排、瞬时生效）。
(function () {
  const MARK = 'data-jopp-picker-ui';
  const ANIM = 'jopp-spin-9f3';

  let root = null;
  let elText = null;
  let elBar = null;
  let elSub = null;
  let elSpin = null;
  let styleInjected = false;

  function injectStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const st = document.createElement('style');
    st.setAttribute(MARK, '1');
    st.textContent =
      '@keyframes ' + ANIM + '{to{transform:rotate(360deg)}}' +
      '[' + MARK + '][data-jopp-overlay="1"] .jopp-ov-bar::after{' +
      'content:"";position:absolute;inset:0;background:linear-gradient(90deg,' +
      'transparent,rgba(255,255,255,0.35),transparent);animation:' + ANIM + '2s linear infinite;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function ensure() {
    if (root && root.isConnected) return;
    injectStyle();

    root = document.createElement('div');
    root.setAttribute(MARK, '1');
    root.setAttribute('data-jopp-overlay', '1');
    root.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;background:rgba(14,14,16,0.9);' +
      'display:flex;align-items:center;justify-content:center;pointer-events:auto;cursor:progress;' +
      'font:14px/1.65 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#f2f2f4;';

    const card = document.createElement('div');
    card.style.cssText =
      'min-width:min(380px,84vw);max-width:min(520px,88vw);padding:24px 28px;border-radius:16px;' +
      'background:rgba(38,38,44,0.97);box-shadow:0 20px 56px rgba(0,0,0,0.55);text-align:center;';

    elSpin = document.createElement('div');
    elSpin.style.cssText =
      'width:32px;height:32px;margin:0 auto 14px;border-radius:50%;box-sizing:border-box;' +
      'border:3px solid rgba(255,255,255,0.18);border-top-color:#ff4d4f;' +
      'animation:' + ANIM + ' 0.9s linear infinite;';

    elText = document.createElement('div');
    elText.style.cssText = 'font-size:14px;font-weight:600;letter-spacing:0.2px;';

    const track = document.createElement('div');
    track.style.cssText =
      'position:relative;height:6px;margin:14px 0 10px;border-radius:999px;' +
      'background:rgba(255,255,255,0.14);overflow:hidden;';

    elBar = document.createElement('div');
    elBar.className = 'jopp-ov-bar';
    elBar.style.cssText =
      'position:absolute;left:0;top:0;bottom:0;width:0%;border-radius:999px;' +
      'background:#ff4d4f;transition:width 0.18s ease-out;overflow:hidden;';

    elSub = document.createElement('div');
    elSub.style.cssText = 'font-size:12px;color:rgba(255,255,255,0.62);';

    track.appendChild(elBar);
    card.appendChild(elSpin);
    card.appendChild(elText);
    card.appendChild(track);
    card.appendChild(elSub);
    root.appendChild(card);
    (document.body || document.documentElement).appendChild(root);
  }

  // opts: { visible: true|false|undefined, text, done, total, indeterminate }
  // visible 为 undefined 时表示"只更新进度，不要改变显隐" ——
  // 截图过程中后台会发进度消息，如果这里擅自显示遮罩，遮罩就会被拍进 PDF。
  function set(opts) {
    const o = opts || {};
    const explicit = (o.visible !== undefined);

    if (o.visible === false) {
      if (root) root.style.visibility = 'hidden';
      return;
    }
    if (!root && !explicit) return;   // 还没建 + 只是更新进度 → 无事可做

    ensure();
    if (explicit) root.style.visibility = 'visible';

    if (typeof o.text === 'string') elText.textContent = o.text;

    const total = Number(o.total) || 0;
    const done = Number(o.done) || 0;
    if (total > 0) {
      const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
      elBar.style.width = pct + '%';
      // unit 让「保存 PDF」（屏）和「保存 HTML」（个资源）共用同一套进度条视觉
      const unit = o.unit || PageSaverI18n.t('ui_a8dd39a0a6cf');
      elSub.textContent = PageSaverI18n.t('ui_9552fe3bd366') + Math.min(done, total) + ' / ' + total + ' ' + unit + '　·　' + pct + '%';
      elSpin.style.display = 'none';
    } else if (o.indeterminate) {
      elBar.style.width = '38%';
      elSub.textContent = '';
      elSpin.style.display = 'block';
    }
  }

  function hide() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
    elText = elBar = elSub = elSpin = null;
  }

  window.joppOverlay = { set: set, hide: hide };
})();
