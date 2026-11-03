/* Browser-owned, on-demand native channel. One connection per operation/save. */
(function (root) {
  'use strict';
  const HOST = 'app.pagesaver.save';
  const UNAVAILABLE = PageSaverI18n.t('ui_97f0b251ced8');
  function connection() {
    const port = browser.runtime.connectNative(HOST);
    let pending = null, closed = false;
    port.onMessage.addListener(message => {
      if (!pending) return;
      const p = pending; pending = null; clearTimeout(p.timer);
      if (message.ok) p.resolve(message);
      else p.reject(new Error(PageSaverI18n.source(message.error) || PageSaverI18n.t('ui_3461df8deb4d')));
    });
    port.onDisconnect.addListener(() => {
      closed = true;
      if (pending) {
        clearTimeout(pending.timer); pending.reject(new Error(UNAVAILABLE)); pending = null;
      }
    });
    return {
      request(message) {
        return new Promise((resolve, reject) => {
          if (closed || pending) { reject(new Error(UNAVAILABLE)); return; }
          const timer = setTimeout(() => {
            pending = null;
            reject(new Error(PageSaverI18n.t('ui_76259d10ca55')));
            port.disconnect();
          }, 20000);
          pending = { resolve, reject, timer };
          try { port.postMessage(message); } catch (e) {
            clearTimeout(timer); pending = null; reject(new Error(UNAVAILABLE));
          }
        });
      },
      close() { if (!closed) port.disconnect(); closed = true; }
    };
  }
  async function call(message) {
    const c = connection();
    try { return await c.request(message); } finally { c.close(); }
  }
  async function save(blob, filename, target) {
    const c = connection();
    try {
      await c.request({ action: 'begin', filename, target, size: blob.size });
      // Stay below Firefox's native message size limits, even after base64 encoding.
      for (let offset = 0; offset < blob.size; offset += 192 * 1024) {
        const bytes = new Uint8Array(await blob.slice(offset, offset + 192 * 1024).arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        await c.request({ action: 'chunk', data: btoa(binary) });
      }
      return await c.request({ action: 'commit' });
    } finally { c.close(); }
  }
  root.PageSaverNative = { call, save };
})(globalThis);
