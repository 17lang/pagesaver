// M0 骨架 + M1.5 Picker 调度 + M2 单页 PDF 合成
//
// pdf-lib 由 manifest 的 background.scripts 在本文件之前加载（挂在 window.PDFLib）。
// 字体（Noto Sans SC，OFL 1.1）按需读取、不常驻内存 —— M3 的文字层才会用到。
browser.runtime.onInstalled.addListener(() => {
  console.log(PageSaverI18n.t('ui_8cee5115f32a'));
  setupMenus();
});

// 右键菜单：Pagesaver 分组（分隔线由 parent 分组 + 浏览器自带）
//   · 保存整页为单页 PDF
//   · 保存为完整 HTML 文件
// 点击后向当前标签页的 content script 发消息，复用既有流程。
function setupMenus() {
  if (!browser.menus) return; // 某些内核无 menus API，降级为只用 popup
  try {
    browser.menus.create({
      id: 'pagesaver',
      title: 'Pagesaver',
      contexts: ['page']
    });
    browser.menus.create({
      id: 'pagesaver-pdf',
      parentId: 'pagesaver',
      title: PageSaverI18n.t('ui_1f993235b6a4'),
      contexts: ['page']
    });
    browser.menus.create({
      id: 'pagesaver-html',
      parentId: 'pagesaver',
      title: PageSaverI18n.t('ui_1736a487f2d5'),
      contexts: ['page']
    });
  } catch (e) { /* 菜单创建失败不影响核心功能 */ }

  browser.menus.onClicked.addListener((info, tab) => {
    if (!tab || !tab.id) return;
    if (info.menuItemId === 'pagesaver-pdf') {
      // content 收到后转发给后台走既有原生截图 PDF 流程
      browser.tabs.sendMessage(tab.id, { type: 'PDF_RUN' }).catch(function () {});
    } else if (info.menuItemId === 'pagesaver-html') {
      browser.tabs.sendMessage(tab.id, { type: 'HTML_RUN' }).catch(function () {});
    }
  });
}

// 兜底：onInstalled 在某些更新路径下可能不触发，这里再确保一次（create 是幂等的会覆盖）
if (browser.menus && browser.menus.onClicked) { setupMenus(); }

const PDF_MAX_PT = 14400;  // PDF 页面尺寸上限（200 英寸），超出要等比缩放
const PX_TO_PT = 0.75;    // 96dpi CSS 像素 → 72pt PDF 点

// 最近一次选取结果。
// 注意：Firefox 的非持久 background page（persistent:false）空闲约 30 秒就会被卸载，
// 内存变量会丢，所以结果要落到 storage.local，M2/M3 取用时才读得出来。
let lastSelection = null;

async function saveSelection(payload) {
  lastSelection = payload;
  try {
    await browser.storage.local.set({ lastSelection: payload });
  } catch (e) { /* 存不下也不影响页面内预览 */ }
}

// popup 点按钮 → background 转发到当前标签页的 content script 启动 picker
async function startPicker(mode) {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs.length) return { ok: false, error: PageSaverI18n.t('ui_251e122b014d') };
  try {
    await browser.tabs.sendMessage(tabs[0].id, { type: 'PICKER_START', mode: mode });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: PageSaverI18n.t('ui_fc062cfa696c')
    };
  }
}

// ---------- 在扩展页面里渲染（绕开目标网站的 CSP）----------
//
// 为什么需要：很多网站 CSP 的 img-src 不含 data:，而 html-to-image 的原理是
// "把图片转成 data: 再加载回来"，于是在这些站点上必然失败。
// 扩展自己的页面 CSP 是宽松的，所以把 DOM 搬过来渲染就不受网站限制了。
const PIXEL_PLACEHOLDER = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function escapeAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

async function renderInExtension(p) {
  if (!window.htmlToImage || !window.htmlToImage.toCanvas) {
    throw new Error(PageSaverI18n.t('ui_99c9a2205727'));
  }

  const width = Math.max(1, Math.round(p.width || 0));
  const height = Math.max(1, Math.round(p.height || 0));

  const doc = '<!DOCTYPE html><html' + (p.htmlAttrs || '') + '><head><meta charset="utf-8">' +
    '<base href="' + escapeAttr(p.baseHref || '') + '">' +
    '<style>html,body{margin:0;padding:0;}</style>' +
    (p.styles || '') +
    '</head><body' + (p.bodyAttrs || '') + '>' + (p.html || '') + '</body></html>';

  const frame = document.createElement('iframe');
  frame.style.cssText =
    'position:fixed;left:-100000px;top:0;border:0;' +
    'width:' + width + 'px;height:' + height + 'px;';
  document.body.appendChild(frame);

  try {
    await new Promise(function (res) {
      var done = false;
      function finish() { if (!done) { done = true; res(); } }
      frame.onload = finish;
      frame.onerror = finish;
      frame.srcdoc = doc;
      setTimeout(finish, 8000); // 兜底：不让一个坏页面卡死整个流程
    });

    // 给图片 / 字体一点加载时间（尽力而为）
    await new Promise(function (r) { setTimeout(r, 600); });

    const canvas = await window.htmlToImage.toCanvas(frame.contentDocument.documentElement, {
      width: width,
      height: height,
      pixelRatio: p.pixelRatio || 1,
      cacheBust: false,
      skipFonts: false,
      imagePlaceholder: PIXEL_PLACEHOLDER
    });

    const blob = await new Promise(function (r) { canvas.toBlob(r, 'image/png'); });
    if (!blob) throw new Error(PageSaverI18n.t('ui_3ca78227fb9d'));
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  } finally {
    if (frame.parentNode) frame.parentNode.removeChild(frame);
  }
}

// ---------- 原生截图路线：滚动 + captureVisibleTab + 拼接 ----------
//
// 为什么不用 html-to-image：它的原理是"把页面图片转成 data: 再画"，而很多站点的 CSP 里
// img-src 不含 data:，直接把它掐死（且跨域图在 content script 里还受 CORS 限制）。
// 浏览器原生截图完全不读页面资源 —— 不受 CSP、不受跨域影响，是这类站点的唯一可靠路径。
// 代价是要滚动拼接；重影问题靠"截图前隐藏 fixed/sticky"解决。

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function loadImg(src) {
  return new Promise(function (res, rej) {
    var img = new Image();
    img.onload = function () { res(img); };
    img.onerror = function () { rej(new Error(PageSaverI18n.t('ui_49ec74ab77c5'))); };
    img.src = src;
  });
}

// 给页面发遮罩指令（失败不影响主流程）
function overlayMsg(tabId, payload) {
  return browser.tabs.sendMessage(tabId, Object.assign({ type: 'CAP_OVERLAY' }, payload || {}))
    .catch(function () { return null; });
}

// 进度：遮罩上的进度条 + 工具栏角标（角标属于浏览器界面，不会被拍进 PDF）
function reportProgress(tabId, done, total) {
  overlayMsg(tabId, { text: PageSaverI18n.t('ui_0482985fe1d9'), done: done, total: total });
  try {
    browser.browserAction.setBadgeText({ text: done + '/' + total, tabId: tabId });
    browser.browserAction.setBadgeBackgroundColor({ color: '#2f6feb', tabId: tabId });
  } catch (e) { /* 角标不影响主流程 */ }
}

// 抓取页面上「指定区域」并拼成一张图（cropRect 省略 = 整页，文档坐标 CSS px）。
//
// 关键设计：只滚"必须滚"的屏数。
//   - 选区在当前视口内 → 一次都不用滚（这是框选/选取框架的绝大多数情况）
//   - 否则只覆盖选区那几屏，不再从 y=0 扫到整页底部
async function captureAndStitch(tabId, windowId, cropRect) {
  var meta = await browser.tabs.sendMessage(tabId, { type: 'CAP_PREPARE' });
  if (!meta || !meta.ok) {
    throw new Error(PageSaverI18n.t('ui_8cf56435ee6a') + ((meta && meta.error) || PageSaverI18n.t('ui_a1a9da9ee6ed')));
  }

  var vw = Math.max(1, Math.round(meta.viewportWidth || 1));
  var vh = Math.max(1, Math.round(meta.viewportHeight || 1));
  var docW = Math.max(1, Math.round(meta.width || vw));
  var docH = Math.max(1, Math.round(meta.height || vh));

  // 目标区域（文档坐标）
  var region = cropRect
    ? { x: Math.round(cropRect.x), y: Math.round(cropRect.y), w: Math.round(cropRect.w), h: Math.round(cropRect.h) }
    : { x: 0, y: 0, w: Math.min(docW, vw), h: docH };

  // 原生截图只能拍到视口宽度，超出的横向部分裁掉
  if (region.x < 0) { region.w += region.x; region.x = 0; }
  if (region.x + region.w > vw) region.w = vw - region.x;
  region.w = Math.max(1, region.w);
  region.h = Math.max(1, Math.min(region.h, Math.max(1, docH - region.y)));

  var maxScrollY = Math.max(0, docH - vh);
  var curX = Math.round(meta.scrollX || 0);
  var curY = Math.round(meta.scrollY || 0);

  // 目标区域是否已经在当前视口里（是 → 零滚动，直接拍）
  var visibleNow = (curY <= region.y + 1) && (region.y + region.h <= curY + vh + 2) && curX === 0;

  var targets = [];
  if (visibleNow) {
    targets = [curY];
  } else {
    var needBottom = region.y + region.h;
    var y = Math.min(Math.max(0, region.y), maxScrollY);
    var guard = 0;
    while (guard++ < 160) {
      // 最后几屏对齐目标区底边，避免多余滚动
      var target = Math.min(y, Math.max(0, needBottom - vh));
      target = Math.min(Math.max(0, target), maxScrollY);
      if (!targets.length || Math.abs(target - targets[targets.length - 1]) > 1) targets.push(target);
      if (target + vh >= needBottom) break;
      if (target >= maxScrollY) break;
      y = target + vh;
    }
    if (!targets.length) targets = [0];
  }

  var shots = [];
  try {
    // 拍照前必须把遮罩藏起来，否则会被拍进 PDF（visibility 切换，瞬时、不重排）
    await overlayMsg(tabId, { visible: false });

    for (var i = 0; i < targets.length; i++) {
      var r = await browser.tabs.sendMessage(tabId, { type: 'CAP_SCROLL_TO', y: targets[i] });
      var actualY = (r && typeof r.y === 'number') ? r.y : targets[i];
      // 已经在正确位置（零滚动那条路）就不用等太久；但不能是 0 ——
      // 遮罩刚切成 hidden，要留一帧让画面重绘，否则遮罩可能被拍进 PDF。
      await sleep(visibleNow && targets.length === 1 ? 70 : 120);
      var dataUrl = await browser.tabs.captureVisibleTab(windowId, { format: 'png' });
      shots.push({ y: actualY, dataUrl: dataUrl });
      reportProgress(tabId, i + 1, targets.length);
    }
  } finally {
    await overlayMsg(tabId, {
      visible: true, text: PageSaverI18n.t('ui_3f69f99839ae'), done: targets.length, total: targets.length
    });
    try { await browser.tabs.sendMessage(tabId, { type: 'CAP_RESTORE' }); } catch (e) { /* 尽力还原 */ }
  }

  if (!shots.length) throw new Error(PageSaverI18n.t('ui_61ac7c83a2ca'));

  // 用第一张截图反推"真实像素比"（Retina 屏通常是 2）。
  // 这一步是清晰度的关键：按 CSS 尺寸建画布等于把 2x 截图降采样成 1x，白扔 75% 像素。
  var firstImg = await loadImg(shots[0].dataUrl);
  var ratio = firstImg.width / vw;
  if (!isFinite(ratio) || ratio <= 0) ratio = 1;

  // 画布只覆盖目标区域：像素 = CSS × ratio，再受总像素上限约束（纯为不把内存撑爆）
  var pxW = Math.round(region.w * ratio);
  var pxH = Math.round(region.h * ratio);
  var SAFETY_PIXELS = 100e6;
  if (pxW * pxH > SAFETY_PIXELS) {
    var f = Math.sqrt(SAFETY_PIXELS / (pxW * pxH));
    pxW = Math.max(1, Math.floor(pxW * f));
    pxH = Math.max(1, Math.floor(pxH * f));
  }
  var k = pxW / region.w;   // 最终画布上"每个 CSS px 对应多少像素"

  var canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (var si = 0; si < shots.length; si++) {
    var img = await loadImg(shots[si].dataUrl);
    // 按原始像素 1:1 绘制（不缩放 → 不糊）；偏移量 = 该屏在目标区域里的位置
    ctx.drawImage(
      img,
      0, 0, img.width, img.height,
      Math.round(-region.x * k), Math.round((shots[si].y - region.y) * k),
      Math.round(vw * k), Math.round(vh * k)
    );
  }

  return {
    canvas: canvas,
    cssWidth: region.w,
    cssHeight: region.h,
    ratio: k,
    region: region,
    screens: targets.length,
    scrolled: !visibleNow
  };
}

// 导出图像字节：一律 PNG 无损（桔子明确要清晰度、不嫌文件大）
function canvasToImageBytes(canvas) {
  return new Promise(function (res, rej) {
    canvas.toBlob(function (blob) {
      if (!blob) { rej(new Error(PageSaverI18n.t('ui_7e16a5e0e4f3'))); return; }
      blob.arrayBuffer().then(function (buf) {
        res({ bytes: new Uint8Array(buf), mime: 'image/png' });
      }, rej);
    }, 'image/png');
  });
}

// 把超长画布切成若干片（每片单边不超过 MAX_SIDE），
// 这样长页面也能保持 2 倍像素：不降清晰度，只是多嵌几张图到同一页。
function sliceCanvas(canvas, maxSide) {
  var MAX_SIDE = maxSide || 16000;
  if (canvas.height <= MAX_SIDE) {
    return [{ canvas: canvas, topPx: 0, heightPx: canvas.height }];
  }
  var parts = [];
  for (var y = 0; y < canvas.height; y += MAX_SIDE) {
    var h = Math.min(MAX_SIDE, canvas.height - y);
    var c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = h;
    c.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    parts.push({ canvas: c, topPx: y, heightPx: h });
  }
  return parts;
}

// 供页面预览用的缩略图（最长边 900）
function canvasToDataUrlSmall(canvas) {
  var max = 900;
  var scale = Math.min(1, max / Math.max(canvas.width, canvas.height));
  if (scale >= 1) return canvas.toDataURL('image/png');
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(canvas.width * scale));
  c.height = Math.max(1, Math.round(canvas.height * scale));
  c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

// ---------- M2：整页 / 选区的图片 → 「一张」单页 PDF ----------

// 建一个 PDF 文档。
// 注意：这个 pdf-lib 版本的 registerFontkit 是 **实例方法**（不是模块级函数），
// 嵌自定义字体前必须在实例上注册，否则 embedFont 会直接抛错。
async function createPdfDoc() {
  const { PDFDocument } = window.PDFLib;
  const pdf = await PDFDocument.create();
  if (window.fontkit) pdf.registerFontkit(window.fontkit);
  return pdf;
}

// M3 用：中文字体按需读取并缓存，不常驻内存（7.9MB）
let fontBytesCache = null;
async function loadChineseFont() {
  if (fontBytesCache) return fontBytesCache;
  const url = browser.runtime.getURL('lib/fonts/NotoSansSC-Regular.otf');
  const res = await fetch(url);
  if (!res.ok) throw new Error(PageSaverI18n.t('ui_80d89199d06a') + res.status);
  fontBytesCache = new Uint8Array(await res.arrayBuffer());
  return fontBytesCache;
}

// 把 PNG 铺满一整张 PDF 页，并在同一位置叠一层"完全透明的真文字"。
//   · 页面尺寸 = 图片 CSS 尺寸 × 0.75（保留原始宽高比 = 一页长图）
//   · 文字层用 opacity:0 绘制：眼睛看不见，但 Ctrl+F 搜得到、鼠标能选中复制
//   · 字体只嵌入用到的字形（subset），7.9MB 的中文字体最终只占几十 KB
// slices: [{ bytes, mime, topPx, heightPx }] —— 长页面会被切成多片，各片按原始像素嵌进同一页
async function buildSinglePagePdf(slices, cssWidth, cssHeight, pixelRatio, textRects) {
  if (!window.PDFLib || !window.PDFLib.PDFDocument) throw new Error(PageSaverI18n.t('ui_a3ced5e93e21'));
  if (!slices || !slices.length) throw new Error(PageSaverI18n.t('ui_9d10e6e8d44e'));

  const pdf = await createPdfDoc();

  let w = cssWidth * PX_TO_PT;
  let h = cssHeight * PX_TO_PT;
  // 超长页面按比例缩到 PDF 尺寸上限内，内容不会被裁掉
  let scale = 1;
  if (w > PDF_MAX_PT) { scale = PDF_MAX_PT / w; w = PDF_MAX_PT; h *= scale; }
  if (h > PDF_MAX_PT) { scale = PDF_MAX_PT / h; h = PDF_MAX_PT; w *= scale; }

  const page = pdf.addPage([w, h]);

  // 逐片嵌入：像素坐标 → CSS → pt；PDF 的 y 从页底往上量
  for (let si = 0; si < slices.length; si++) {
    const sl = slices[si];
    const img = (sl.mime === 'image/jpeg')
      ? await pdf.embedJpg(sl.bytes)
      : await pdf.embedPng(sl.bytes);
    const cssTop = sl.topPx / pixelRatio;
    const cssH = sl.heightPx / pixelRatio;
    const ptH = cssH * PX_TO_PT * scale;
    const ptY = (cssHeight - cssTop) * PX_TO_PT * scale - ptH;
    page.drawImage(img, { x: 0, y: ptY, width: w, height: ptH });
  }

  // ---- 文字层 ----
  let textCount = 0;
  let textError = '';
  if (textRects && textRects.length) {
    try {
      const fontBytes = await loadChineseFont();
      const font = await pdf.embedFont(fontBytes, { subset: true });
      const k = PX_TO_PT * scale;   // CSS px → pt（含超长页面的缩放）

      for (let i = 0; i < textRects.length; i++) {
        const it = textRects[i];
        const s = (it.t || '').trim();
        if (!s) continue;

        const sizePt = Math.max(1, it.s * k);
        const xPt = it.x * k;
        // CSS 的 y 是"文字块顶部"，PDF 的 y 是基线且从页底往上量
        const baselineCss = it.y + it.h * 0.8;
        const yPt = h - baselineCss * k;
        if (yPt < -sizePt || yPt > h + sizePt) continue;

        try {
          page.drawText(s, {
            x: xPt,
            y: yPt,
            size: sizePt,
            font: font,
            opacity: 0          // 关键：完全透明，视觉零影响
          });
          textCount++;
        } catch (e) {
          // 某个字符不在字体里就会抛错，跳过这一条即可（不影响其它文字）
        }
      }
    } catch (e) {
      textError = String(e && e.message ? e.message : e);
    }
  }

  return { bytes: await pdf.save(), textCount: textCount, textError: textError };
}

function safeFileName(name) {
  const s = String(name || 'page').replace(/[\\/:*?"<>|\r\n\t]/g, '').trim();
  return Array.from(s || 'page').slice(0, 80).join('');
}

async function publicationMetadata(tabId, publishedDate) {
  if (PageSaverNaming.normalizeDate(publishedDate)) return { publishedDate };
  try { return await browser.tabs.sendMessage(tabId, { type: 'PAGESAVER_PAGE_METADATA' }) || {}; }
  catch (error) { return {}; }
}

// One destination resolver and one writer for all three formats.
async function saveFile(blob, filename, kind, metadata = {}) {
  const settings = await PageSaverDestinations.load();
  if (settings.naming.enabled) {
    filename = PageSaverNaming.buildFileName(metadata.title || filename.replace(/\.[^.]+$/, ''),
      metadata.publishedDate, kind === 'markdown' ? 'md' : kind, settings.naming);
  }
  const target = PageSaverDestinations.target(settings, kind);
  if (target && kind === 'markdown' && target.mode === 'obsidian') return PageSaverObsidian.save(blob, filename, target);
  if (target) return PageSaverNative.save(blob, filename, await PageSaverObsidian.nativeTarget(target));
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
    return { filename };
  } finally {
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
}
async function savePdf(bytes, filename, metadata) {
  return saveFile(new Blob([bytes], { type: 'application/pdf' }), filename, 'pdf', metadata);
}

// ---------- M8：完整 HTML 文件保存（对标 SingleFile，自研实现）----------
//
// 资源抓取放在后台：扩展后台持有 <all_urls> 权限，fetch 不受目标站的 CSP / CORS 限制 ——
// 这与我们做 PDF 时用 captureVisibleTab 绕开 CSP 是同一套经验。
const HTML_MAX_INLINE = 20 * 1024 * 1024; // 单资源 > 20MB 不内联，保留原 URL（由 <base> 兜底）

function guessMime(url) {
  const u = String(url).split('?')[0].split('#')[0].toLowerCase();
  if (/\.css$/.test(u)) return 'text/css';
  if (/\.js$/.test(u)) return 'application/javascript';
  if (/\.svg$/.test(u)) return 'image/svg+xml';
  if (/\.png$/.test(u)) return 'image/png';
  if (/\.jpe?g$/.test(u)) return 'image/jpeg';
  if (/\.gif$/.test(u)) return 'image/gif';
  if (/\.webp$/.test(u)) return 'image/webp';
  if (/\.avif$/.test(u)) return 'image/avif';
  if (/\.ico$/.test(u)) return 'image/x-icon';
  if (/\.woff2$/.test(u)) return 'font/woff2';
  if (/\.woff$/.test(u)) return 'font/woff';
  if (/\.ttf$/.test(u)) return 'font/ttf';
  if (/\.otf$/.test(u)) return 'font/otf';
  if (/\.eot$/.test(u)) return 'application/vnd.ms-fontobject';
  if (/\.mp4$/.test(u)) return 'video/mp4';
  if (/\.webm$/.test(u)) return 'video/webm';
  if (/\.mp3$/.test(u)) return 'audio/mpeg';
  return 'application/octet-stream';
}

function isTextMime(mime) {
  return /^(text\/|application\/(javascript|json|xhtml\+xml|xml)|image\/svg\+xml)/i.test(mime || '');
}

// 读成 base64（自己拼 mime，避免 blob.type 为空时生成无法识别的 data URI）
function blobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    const fr = new FileReader();
    fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
    fr.onerror = function () { reject(new Error(PageSaverI18n.t('ui_e12c5a8144ac'))); };
    fr.readAsDataURL(blob);
  });
}

function fetchWithTimeout(url, init, ms) {
  return Promise.race([
    fetch(url, init),
    new Promise(function (_, rej) { setTimeout(function () { rej(new Error(PageSaverI18n.t('ui_8b7f52f0dbb6'))); }, ms || 20000); })
  ]);
}

async function fetchAsDataUri(url) {
  let res = null;
  const base = { cache: 'force-cache' };
  try {
    res = await fetchWithTimeout(url, Object.assign({}, base, { credentials: 'include' }));
    // 防盗链/权限问题：去掉 referrer 再试一次（SingleFile 的三级兜底思路）
    if (!res.ok && (res.status === 401 || res.status === 403 || res.status === 404)) {
      res = await fetchWithTimeout(url, Object.assign({}, base, { referrerPolicy: 'no-referrer' }));
    }
  } catch (e) {
    try {
      res = await fetchWithTimeout(url, Object.assign({}, base, { referrerPolicy: 'no-referrer' }));
    } catch (e2) {
      return { ok: false, error: PageSaverI18n.t('ui_dcdb4404b121') + String(e2 && e2.message ? e2.message : e2) };
    }
  }
  if (!res || !res.ok) return { ok: false, error: 'HTTP ' + (res ? res.status : '?') };

  let blob;
  try { blob = await res.blob(); } catch (e) { return { ok: false, error: PageSaverI18n.t('ui_1fd8511c4d2c') }; }
  if (blob.size > HTML_MAX_INLINE) return { ok: false, tooLarge: true };

  const mime = (blob.type && blob.type !== 'application/octet-stream') ? blob.type : guessMime(url);
  let dataUri;
  try { dataUri = 'data:' + mime + ';base64,' + (await blobToBase64(blob)); }
  catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) }; }

  // CSS 等文本额外返回原文，供 content 端解析其中的 url()/@import 再抓一轮
  let text;
  if (isTextMime(mime)) {
    try { text = await blob.text(); } catch (e) {}
  }
  return { ok: true, dataUri: dataUri, text: text, mime: mime };
}

async function saveHtmlFile(text, filename, metadata) {
  return saveFile(new Blob([text], { type: 'text/html;charset=utf-8' }), filename, 'html', metadata);
}
async function saveTextFile(text, filename, metadata) {
  return saveFile(new Blob([text], { type: 'text/markdown;charset=utf-8' }), filename, 'markdown', metadata);
}

// ---------- SingleFile 内核的后台代抓（页面内 fetch 失败时的兜底）----------
//
// 用 XMLHttpRequest 而不是 fetch：扩展后台持有 <all_urls> 权限，XHR + withCredentials
// 能带上目标站的 cookie，且不受页面 CSP / CORS 限制 —— 这正是 SingleFile 的做法。
const FETCH_MAX_BLOCK = 8 * 1024 * 1024;   // 单条消息上限 8MB，超了分片回传

function parseRawHeaders(rawHeaders) {
  return String(rawHeaders || '').trim().split(/[\r\n]+/).map(function (line) {
    const i = line.indexOf(':');
    return [line.substring(0, i).trim(), line.substring(i + 1).trim()];
  }).filter(function (pair) { return pair[0]; });
}

function bgFetchResource(url, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    let xhr;
    try { xhr = new XMLHttpRequest(); }
    catch (e) { reject(new Error(PageSaverI18n.t('ui_f67b2f4f0488'))); return; }
    xhr.withCredentials = true;
    xhr.responseType = 'arraybuffer';
    xhr.onerror = function () { reject(new Error(PageSaverI18n.t('ui_88c035ff99b6'))); };
    xhr.onreadystatechange = function () {
      if (xhr.readyState === 4) {
        if (xhr.status || (xhr.response && xhr.response.byteLength)) {
          const bytes = new Uint8Array(xhr.response);
          resolve({
            arrayBuffer: xhr.response,
            array: Array.prototype.slice.call(bytes),
            headers: parseRawHeaders(xhr.getAllResponseHeaders()),
            status: xhr.status
          });
        } else {
          reject(new Error(PageSaverI18n.t('ui_9852a9ce3594')));
        }
      }
    };
    try {
      xhr.open('GET', url, true);
      if (options.headers) {
        for (const k in options.headers) {
          if (Object.prototype.hasOwnProperty.call(options.headers, k)) {
            xhr.setRequestHeader(k, options.headers[k]);
          }
        }
      }
      xhr.send();
    } catch (e) {
      reject(new Error(String(e && e.message ? e.message : e)));
    }
  });
}

// 分片把抓取结果回传给页面（内核按 requestId 归位）
async function sendFetchResponse(tabId, requestId, response) {
  const arr = response.array || [];
  const truncated = arr.length > FETCH_MAX_BLOCK;
  const blocks = truncated ? Math.ceil(arr.length / FETCH_MAX_BLOCK) : 1;
  for (let i = 0; i < blocks; i++) {
    const message = {
      method: 'singlefile.fetchResponse',
      requestId: requestId,
      headers: response.headers || [],
      status: response.status,
      error: response.error
    };
    if (truncated) {
      message.truncated = true;
      message.finished = ((i + 1) * FETCH_MAX_BLOCK) >= arr.length;
      message.array = arr.slice(i * FETCH_MAX_BLOCK, (i + 1) * FETCH_MAX_BLOCK);
    } else {
      message.array = arr;
    }
    try {
      await browser.tabs.sendMessage(tabId, message);
    } catch (e) { /* 页面已关闭/无接收方，忽略 */ }
  }
}

// 懒加载计时器表（按 type@tabId 区分，避免多标签页互相串台）
const lazyTimers = new Map();

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return false;

  // ---- HTML 内核（SingleFile）的后台代抓协议 ----
  // 内核用 msg.method（而不是我们的 msg.type），页面内 fetch 失败时会转到这里。
  if (typeof msg.method === 'string' && msg.method.indexOf('singlefile.') === 0) {
    const tabId = (sender && sender.tab) ? sender.tab.id : null;

    if (msg.method === 'singlefile.fetch') {
      (async function () {
        try {
          const r = await bgFetchResource(msg.url, { referrer: msg.referrer, headers: msg.headers });
          if (tabId != null) await sendFetchResponse(tabId, msg.requestId, r);
          return {};
        } catch (e) {
          if (tabId != null) {
            await sendFetchResponse(tabId, msg.requestId, {
              error: String(e && e.message ? e.message : e), status: 0, headers: [], array: []
            });
          }
          return {};
        }
      })()
        .then((r) => sendResponse(r))
        .catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
      return true; // 异步响应
    }

    if (msg.method === 'singlefile.fetchFrame') {
      bgFetchResource(msg.url, { referrer: msg.referrer, headers: msg.headers })
        .then((r) => sendResponse({ status: r.status, headers: r.headers, array: r.array }))
        .catch((e) => sendResponse({ error: String(e && e.message ? e.message : e) }));
      return true; // 异步响应
    }

    // ---- 懒加载（loadDeferredContent）的超时委托 ----
    // 内核的 pg() 把所有计时（idleTimeout/loadTimeout/maxTimeout/endTimeout）都委托给后台：
    // 它 await 一条 singlefile.lazyTimeout.setTimeout 消息，期望后台到点后回传
    // singlefile.lazyTimeout.onTimeout（带 type），内核据此调用挂起的回调 → pg 才能 resolve。
    // 之前漏了这两条消息，导致计时回调永不触发、pg 只能等「页面空闲」才结束；
    // 而 GitHub Pages / SPA 常有常驻活动（GIF、心跳），页面永远不空闲 → 永久卡死在「正在分析页面…」。
    if (msg.method === 'singlefile.lazyTimeout.setTimeout') {
      const tid = msg.type;
      const delay = msg.delay || 0;
      if (tid && tabId != null) {
        const key = tid + '@' + tabId;
        if (lazyTimers.has(key)) clearTimeout(lazyTimers.get(key));
        const handle = setTimeout(function () {
          lazyTimers.delete(key);
          browser.tabs.sendMessage(tabId, { method: 'singlefile.lazyTimeout.onTimeout', type: tid })
            .catch(function () { /* 页面已关闭/无接收方，忽略 */ });
        }, delay);
        lazyTimers.set(key, handle);
      }
      sendResponse({ ok: true });
      return false; // 同步响应（内核只 await 是否成功，不依赖返回值）
    }

    if (msg.method === 'singlefile.lazyTimeout.clearTimeout') {
      const tid = msg.type;
      if (tid && tabId != null) {
        const key = tid + '@' + tabId;
        if (lazyTimers.has(key)) { clearTimeout(lazyTimers.get(key)); lazyTimers.delete(key); }
      }
      sendResponse({ ok: true });
      return false;
    }

    return false;
  }

  if (msg.type === 'PICKER_START') {
    startPicker(msg.mode)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  if (msg.type === 'PICKER_DONE') {
    saveSelection(msg.payload || null);
    try {
      browser.browserAction.setBadgeText({ text: '✓' });
      browser.browserAction.setBadgeBackgroundColor({ color: '#2f6feb' });
    } catch (e) { /* 忽略：非关键路径 */ }
    return false;
  }

  // ---- M8：完整 HTML 保存的消息通道 ----

  // popup 点「保存为完整 HTML 文件」→ 转发到当前标签页执行（进度条在页面上）
  if (msg.type === 'HTML_SAVE_START') {
    (async function () {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) return { ok: false, error: PageSaverI18n.t('ui_251e122b014d') };
      try {
        await browser.tabs.sendMessage(tabs[0].id, { type: 'HTML_RUN' });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: PageSaverI18n.t('ui_fc062cfa696c') };
      }
    })()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  // popup 点「保存为 Markdown 文件」→ 转发到当前标签页执行（进度条在页面上）
  if (msg.type === 'MARKDOWN_RUN_START') {
    (async function () {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) return { ok: false, error: PageSaverI18n.t('ui_251e122b014d') };
      try {
        await browser.tabs.sendMessage(tabs[0].id, { type: 'MARKDOWN_RUN' });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: PageSaverI18n.t('ui_fc062cfa696c') };
      }
    })()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  // content 请求后台代抓单个资源 → data URI（带 no-referrer 重试）
  if (msg.type === 'HTML_FETCH') {
    fetchAsDataUri(msg.url)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  // content 序列化完成 → 落盘 .html
  if (msg.type === 'HTML_SAVE') {
    (async function () {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const title = msg.title || (tabs[0] && tabs[0].title) || 'page';
      const filename = safeFileName(title) + PageSaverI18n.t('ui_8e626b043164');
      const metadata = await publicationMetadata(sender.tab ? sender.tab.id : (tabs[0] && tabs[0].id), msg.publishedDate);
      const saved = await saveHtmlFile(msg.html || '', filename, { ...metadata, title });
      return { ok: true, filename: saved.filename, path: saved.path, handedOff: !!saved.handedOff };
    })()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  // Markdown 保存：content 把正文 Markdown 发来，后台用 downloads.download 写入磁盘。
  if (msg.type === 'MARKDOWN_SAVE') {
    (async function () {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const title = msg.title || (tabs[0] && tabs[0].title) || 'page';
      const filename = safeFileName(title) + '.md';
      const metadata = await publicationMetadata(sender.tab ? sender.tab.id : (tabs[0] && tabs[0].id), msg.publishedDate);
      const saved = await saveTextFile(msg.markdown || '', filename, { ...metadata, title });
      return { ok: true, filename: saved.filename, path: saved.path, handedOff: !!saved.handedOff };
    })()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  // content 报进度时同步更新工具栏角标（浏览器界面，不会被拍进任何产物）
  if (msg.type === 'HTML_BADGE') {
    try {
      const tabId = sender && sender.tab ? sender.tab.id : undefined;
      if (msg.done < 0) {
        browser.browserAction.setBadgeText({ text: '', tabId: tabId });
      } else {
        browser.browserAction.setBadgeText({ text: msg.done + '/' + msg.total, tabId: tabId });
        browser.browserAction.setBadgeBackgroundColor({ color: '#0a7d3b', tabId: tabId });
      }
    } catch (e) { /* 角标不影响主流程 */ }
    return false;
  }

  // 原生截图 → 单页 PDF（整页 / 指定矩形）。这条路径不受页面 CSP 与跨域限制。
  if (msg.type === 'CAPTURE_PAGE_PDF' || msg.type === 'CAPTURE_RECT_PDF') {
    (async function () {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs.length) throw new Error(PageSaverI18n.t('ui_251e122b014d'));
      const tab = tabs[0];
      const metadata = await publicationMetadata(tab.id, msg.publishedDate);
      const crop = (msg.type === 'CAPTURE_RECT_PDF' && msg.rect) ? msg.rect : null;

      // 统一交互：一上来就全屏置灰 + 进度条，用户看不到后面的滚动
      await overlayMsg(tab.id, { visible: true, text: PageSaverI18n.t('ui_f07335163e36'), indeterminate: true });

      let rects = [];
      let stitched = null;
      try {
        // ① 先采文字层：必须在滚动截图之前（页面还在原位、浮层还没被隐藏）
        try {
          const tr = await browser.tabs.sendMessage(tab.id, { type: 'CAP_TEXT_LAYER', rect: crop });
          if (tr && tr.ok) rects = tr.rects || [];
        } catch (e) { /* 文字层失败不影响底图，最多是 PDF 搜不到字 */ }

        // ② 截图 + 拼接（只覆盖目标区域，能一屏拍下就不滚）
        stitched = await captureAndStitch(tab.id, tab.windowId, crop);

        // 画布原点 = 实际截取区域，文字坐标跟着平移
        const reg = stitched.region || { x: 0, y: 0 };
        if (reg.x || reg.y) {
          rects = rects.map(function (r) {
            return { t: r.t, x: r.x - reg.x, y: r.y - reg.y, w: r.w, h: r.h, s: r.s };
          });
        }

        // ③ 超长画布切片（每片仍是原始像素），再逐片嵌进同一页 PDF
        await overlayMsg(tab.id, { visible: true, text: PageSaverI18n.t('ui_3f69f99839ae'), indeterminate: true });
        const parts = sliceCanvas(stitched.canvas, 16000);
        const slices = [];
        for (let pi = 0; pi < parts.length; pi++) {
          const imgData = await canvasToImageBytes(parts[pi].canvas);
          slices.push({
            bytes: imgData.bytes,
            mime: imgData.mime,
            topPx: parts[pi].topPx,
            heightPx: parts[pi].heightPx
          });
        }

        const built = await buildSinglePagePdf(
          slices, stitched.cssWidth, stitched.cssHeight, stitched.ratio, rects
        );
        const filename = safeFileName(msg.title || tab.title) + PageSaverI18n.t('ui_956ed149ef11');
        const saved = await savePdf(built.bytes, filename, { ...metadata, title: msg.title || tab.title });

        return {
          ok: true,
          filename: saved.path || saved.filename,
          preview: canvasToDataUrlSmall(stitched.canvas),
          width: stitched.cssWidth,
          height: stitched.cssHeight,
          pixelWidth: stitched.canvas.width,
          pixelHeight: stitched.canvas.height,
          screens: stitched.screens,
          scrolled: stitched.scrolled,
          textCount: built.textCount,
          textError: built.textError || ''
        };
      } finally {
        await overlayMsg(tab.id, { visible: false });
        await overlayMsg(tab.id, { hide: true });
        try { browser.browserAction.setBadgeText({ text: '', tabId: tab.id }); } catch (e) { /* 忽略 */ }
      }
    })()
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  if (msg.type === 'RENDER_DOM') {
    renderInExtension(msg.payload || {})
      .then((bytes) => sendResponse({ ok: true, bytes: bytes }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  if (msg.type === 'MAKE_PDF') {
    const p = msg.payload || {};
    const bytes = p.bytes ? new Uint8Array(p.bytes) : null;
    if (!bytes || !bytes.length) {
      sendResponse({ ok: false, error: PageSaverI18n.t('ui_44caf2849ed2') });
      return false;
    }
    buildSinglePagePdf(
        [{ bytes: bytes, mime: 'image/png', topPx: 0, heightPx: p.height || 1 }],
        p.width || 1, p.height || 1, 1, null
      )
      .then(async (built) => {
        const metadata = await publicationMetadata(sender.tab && sender.tab.id, p.publishedDate);
        const filename = safeFileName(p.title) + PageSaverI18n.t('ui_956ed149ef11');
        return savePdf(built.bytes, filename, { ...metadata, title: p.title }).then(saved => saved.path || saved.filename);
      })
      .then((filename) => sendResponse({ ok: true, saved: true, filename: filename }))
      .catch((e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) }));
    return true; // 异步响应
  }

  return false;
});
