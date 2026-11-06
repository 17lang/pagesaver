/* Read publication metadata only. Never mistake an arbitrary date in body text for publication. */
(function () {
  'use strict';
  function readPublishedDate() {
    const candidates = [];
    for (const selector of [
      'meta[property="article:published_time"]', 'meta[name="article:published_time"]',
      'meta[itemprop="datePublished"]', 'meta[name="date"]', 'meta[name="pubdate"]',
      'meta[name="publishdate"]', 'meta[name="publish_date"]',
      'time[itemprop="datePublished"]', 'time[pubdate]', '#publish_time'
    ]) {
      for (const element of document.querySelectorAll(selector)) {
        candidates.push(element.getAttribute('content') || element.getAttribute('datetime') || element.textContent);
      }
    }
    function collect(value) {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) { value.forEach(collect); return; }
      if (typeof value.datePublished === 'string') candidates.push(value.datePublished);
      if (value['@graph']) collect(value['@graph']);
      if (value.mainEntity) collect(value.mainEntity);
    }
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { collect(JSON.parse(script.textContent)); } catch (error) { /* Ignore malformed site metadata. */ }
    }
    // WeChat supplies a Unix publication timestamp in its page scripts.
    if (location.hostname === 'mp.weixin.qq.com') {
      for (const script of document.scripts) {
        const match = script.textContent.match(/\b(?:var\s+)?ct\s*=\s*["']?(\d{10})\b/);
        if (match) {
          const date = new Date(Number(match[1]) * 1000);
          candidates.push(new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
          }).format(date));
        }
      }
    }
    return candidates.map(PageSaverNaming.normalizeDate).find(Boolean) || null;
  }
  globalThis.PageSaverPageMetadata = { readPublishedDate };
  browser.runtime.onMessage.addListener(message => {
    if (message && message.type === 'PAGESAVER_PAGE_METADATA') return Promise.resolve({ publishedDate: readPublishedDate() });
    return undefined;
  });
})();
