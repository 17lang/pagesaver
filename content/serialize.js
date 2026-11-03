// 页面序列化：把要截的 DOM 打包成"能搬到扩展页面里重建"的数据。
//
// 为什么需要它：
//   很多网站的 CSP 里 img-src 不含 data:，而 html-to-image 的原理是"把图片转成 data: 再加载"，
//   于是在这些站点上必然失败。解法是把它拿到扩展自己的页面里渲染（扩展页面 CSP 宽松）。
//
// 关键技巧：
//   不内联 CSS（那会让体积爆炸且还原不准），而是把 <link>/<style> 原样搬过去，
//   再加一个 <base href="原页面地址">，这样相对路径（图片、字体、背景图）在新页面里也能正确解析。
(function () {
  const MARK = 'data-jopp-picker-ui';

  function escAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // target 省略 = 整页；传元素 = 只序列化那个元素
  function serialize(target) {
    const isWholePage = !target || target === document.documentElement || target === document.body;
    const root = target || document.body;

    // 克隆一份，避免动到真实页面
    const clone = root.cloneNode(true);

    // 去掉我们自己的 UI、所有脚本（新页面里没意义，还有执行风险）、noscript 占位
    clone.querySelectorAll('[' + MARK + ']').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('script').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('noscript').forEach(function (n) { n.remove(); });

    // 量尺寸（用原始元素量，不受克隆影响）
    const rect = root.getBoundingClientRect();
    const width = Math.max(root.scrollWidth || 0, root.offsetWidth || 0, rect.width || 0);
    const height = Math.max(root.scrollHeight || 0, root.offsetHeight || 0, rect.height || 0);

    // 样式表原样带走（外部 CSS 靠 <base> 解析相对路径）
    const styles = Array.from(document.querySelectorAll('link[rel~="stylesheet"], style'))
      .map(function (n) { return n.outerHTML; })
      .join('\n');

    // 整页时取 body 内部内容（否则外层的 <html>/<body> 会和新页面的嵌套冲突）；
    // 同时保留 body 自身的 class / style（它们常决定布局）
    let html;
    let bodyAttrs = '';
    if (isWholePage) {
      html = (document.body || root).innerHTML;
      const cls = document.body ? document.body.getAttribute('class') : '';
      const sty = document.body ? document.body.getAttribute('style') : '';
      if (cls) bodyAttrs += ' class="' + escAttr(cls) + '"';
      if (sty) bodyAttrs += ' style="' + escAttr(sty) + '"';
    } else {
      html = clone.outerHTML;
    }

    // 同样，整页时把 html 元素的 class/style 也带上
    const htmlAttrs = (function () {
      if (!isWholePage) return '';
      const de = document.documentElement;
      let s = '';
      const cls = de.getAttribute('class');
      const sty = de.getAttribute('style');
      if (cls) s += ' class="' + escAttr(cls) + '"';
      if (sty) s += ' style="' + escAttr(sty) + '"';
      return s;
    })();

    return {
      html: html,
      styles: styles,
      baseHref: location.href,
      width: Math.round(width),
      height: Math.round(height),
      wholePage: isWholePage,
      bodyAttrs: bodyAttrs,
      htmlAttrs: htmlAttrs,
      title: document.title
    };
  }

  window.joppSerialize = { page: serialize };
})();
