// 文字层采集：把页面上「每行文字」的内容 + 坐标 + 字号抓出来。
//
// 为什么这层不受截图方式影响：
//   它只读 DOM（文本节点 + Range.getClientRects），不碰图片、不碰 CSP、不碰跨域。
//   拿到的坐标是 CSS 像素的文档坐标，跟原生截图 1:1 对齐，所以两层能严丝合缝地叠在一起。
//
// 排除规则要和截图保持一致：fixed / sticky 的浮层在截图里被隐藏了，这里也要排除，
// 否则会出现"画面里没有、但能被搜到"的幽灵文字。
(function () {
  const MARK = 'data-jopp-picker-ui';
  const MAX_ITEMS = 12000;   // 超大页面兜底，避免卡死

  function csOf(el) {
    try { return getComputedStyle(el); } catch (e) { return null; }
  }

  function isInvisible(el) {
    const cs = csOf(el);
    if (!cs) return true;
    return cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0;
  }

  function isFloating(el) {
    const cs = csOf(el);
    if (!cs) return false;
    return cs.position === 'fixed' || cs.position === 'sticky';
  }

  // 祖先链里只要有一个浮层，整段都不要（浮层在截图时被隐藏了）
  function insideFloating(el, stopAt) {
    let a = el;
    while (a && a !== stopAt) {
      if (isFloating(a)) return true;
      a = a.parentElement;
    }
    return false;
  }

  // 文本按行数均分（近似）——PDF 里的文字位置不需要像素级精确，能搜到、能选中即可
  function splitEvenly(text, n) {
    if (n <= 1) return [text];
    const per = Math.ceil(text.length / n);
    const out = [];
    for (let i = 0; i < n; i++) out.push(text.slice(i * per, (i + 1) * per));
    return out;
  }

  // root 省略 = 整页；rect 有值时只保留与该矩形相交的文字
  function collect(root, rect) {
    const scope = root || document.body;
    if (!scope) return [];

    const out = [];
    let walker;
    try {
      walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, null);
    } catch (e) { return []; }

    let node;
    while ((node = walker.nextNode())) {
      if (out.length >= MAX_ITEMS) break;

      const text = node.nodeValue;
      if (!text || !text.trim()) continue;

      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest('[' + MARK + ']')) continue;
      if (isInvisible(parent)) continue;
      if (insideFloating(parent, scope)) continue;

      const cs = csOf(parent);
      if (!cs) continue;
      const size = parseFloat(cs.fontSize) || 14;

      let range;
      try {
        range = document.createRange();
        range.selectNodeContents(node);
      } catch (e) { continue; }

      let rects;
      try { rects = range.getClientRects(); } catch (e) { continue; }
      if (!rects || !rects.length) continue;

      const parts = splitEvenly(text, rects.length);

      for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        if (r.width < 1 || r.height < 1) continue;

        const docX = r.left + window.scrollX;
        const docY = r.top + window.scrollY;

        if (rect) {
          if (docX + r.width < rect.x || docX > rect.x + rect.w) continue;
          if (docY + r.height < rect.y || docY > rect.y + rect.h) continue;
        }

        out.push({
          t: parts[i] || '',
          x: Math.round(docX),
          y: Math.round(docY),
          w: Math.round(r.width),
          h: Math.round(r.height),
          s: Math.round(size * 10) / 10
        });

        if (out.length >= MAX_ITEMS) break;
      }
    }

    return out;
  }

  window.joppTextLayer = { collect: collect };
})();
