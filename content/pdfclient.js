// M2 · 共享渲染工具 + PDF 请求
//
// 为什么不直接在 content 里合成 PDF：
// pdf-lib 有 525KB、中文字体 7.9MB，放进 content_scripts 意味着每个网页都要背这份重量。
// 放进 background（manifest 的 background.scripts）则只在需要合成时才用，页面加载不受影响。
(function () {
  // 1×1 透明 PNG：给加载失败的图片当占位，避免 <img src=""> 引发二次失败
  var PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  function h2i() { return window.htmlToImage; }

  // html-to-image 失败时抛的常常是 Event 对象（它内部写的是 img.onerror = reject），
  // 直接 String() 会变成 "[object Event]"，这里翻译成人能看懂的话。
  function describeRenderError(e) {
    if (e && e.message) return e.message;
    if (e && e.type) {
      return PageSaverI18n.t('ui_cb747e106663');
    }
    return String(e);
  }

  // 把两个 filter 合并（原始的 + 追加的）
  function mergeFilters(a, b) {
    if (!a) return b;
    if (!b) return a;
    return function (node) { return a(node) && b(node); };
  }

  // 带两级降级的渲染：
  //   ① 先在页面里用 html-to-image 渲染（快；没有严格 CSP 的站点多数能成）
  //   ② 失败 → 把 DOM 序列化后交给 background，在**扩展自己的页面**里渲染
  //      （很多网站 CSP 的 img-src 不含 data:，而 html-to-image 必须把图片转成 data:，
  //        在那些站点上第 ① 步必然失败，只能靠 ② 绕开）
  async function renderCanvas(node, opts) {
    if (!h2i() || !h2i().toCanvas) {
      var boot = (window.__joppBootErrors || []).join('；');
      throw new Error(PageSaverI18n.t('ui_a1791229b274') + (boot ? PageSaverI18n.t('ui_93a11c9ada3c') + boot + '）' : PageSaverI18n.t('ui_cc7c29ed42be')));
    }

    var base = Object.assign({
      cacheBust: false,        // 加时间戳会让带签名的图片 URL 直接 404
      skipFonts: false,
      imagePlaceholder: PLACEHOLDER
    }, opts || {});

    // ① 页面内渲染
    try {
      return await h2i().toCanvas(node, base);
    } catch (e1) {
      console.warn(PageSaverI18n.t('ui_0f5b9378e8e7'), describeRenderError(e1));
    }

    // ② 扩展到页面渲染
    if (!window.joppSerialize) {
      throw new Error(PageSaverI18n.t('ui_4fea61341cb2'));
    }
    var ser;
    try {
      ser = window.joppSerialize.page(node === document.documentElement ? null : node);
      ser.pixelRatio = base.pixelRatio || 1;
      if (base.width) ser.width = base.width;
      if (base.height) ser.height = base.height;
    } catch (e2) {
      throw new Error(PageSaverI18n.t('ui_0fc7ef88d1a2') + describeRenderError(e2));
    }

    var res;
    try {
      res = await browser.runtime.sendMessage({ type: 'RENDER_DOM', payload: ser });
    } catch (e3) {
      throw new Error(PageSaverI18n.t('ui_650ecab07391') + describeRenderError(e3));
    }
    if (!res || !res.ok) {
      throw new Error(PageSaverI18n.t('ui_126982202094') + ((res && res.error) || PageSaverI18n.t('ui_a1a9da9ee6ed')));
    }

    // PNG 字节 → canvas
    var blob = new Blob([res.bytes], { type: 'image/png' });
    var bitmap = await createImageBitmap(blob);
    var canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    return canvas;
  }

  // 画布 → 交 background 合成单页 PDF 并下载
  async function canvasToPdf(canvas, size, title) {
    if (!canvas) throw new Error(PageSaverI18n.t('ui_ad42eb8973a6'));
    if (!window.joppPdf || !window.joppPdf.ready) throw new Error(PageSaverI18n.t('ui_464b5e833cbc'));

    // PNG 字节：传二进制（Uint8Array）比传 base64 字符串省约 1/3 体积
    const blob = await new Promise(function (res) { canvas.toBlob(res, 'image/png'); });
    if (!blob) throw new Error(PageSaverI18n.t('ui_40346d713141'));
    const buf = await blob.arrayBuffer();

    const res = await browser.runtime.sendMessage({
      type: 'MAKE_PDF',
      payload: {
        bytes: new Uint8Array(buf),
        width: size && size.width ? size.width : canvas.width,
        height: size && size.height ? size.height : canvas.height,
        title: title || document.title
      }
    });
    return res;
  }

  window.joppRender = { toCanvas: renderCanvas, describeError: describeRenderError };
  window.joppPdf = { canvasToPdf: canvasToPdf, ready: true };
})();
