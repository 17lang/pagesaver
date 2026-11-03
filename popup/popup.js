// popup：两个入口 —— 整页长图（M1）与选取局部（M1.5）。
// picker 启动后 popup 会关闭，让用户把注意力交回页面（页面里会直接显示结果浮层）。
(async function () {
  document.getElementById('open-settings').addEventListener('click', () => browser.runtime.openOptionsPage());
  const img = document.getElementById('preview');
  const info = document.getElementById('info');
  const status = document.getElementById('status');

  async function makeFullPagePdf() {
    status.textContent = PageSaverI18n.t('ui_510969f560df');
    try {
      // 直接让后台做：原生截图（captureVisibleTab）+ 拼接 + 合成 PDF
      // 不走 html-to-image，所以不受网站 CSP 和跨域限制
      const res = await browser.runtime.sendMessage({ type: 'CAPTURE_PAGE_PDF' });
      if (!res || !res.ok) {
        status.textContent = PageSaverI18n.t('ui_cfdcd1611998') + ((res && res.error) || PageSaverI18n.t('ui_13a46616e16f'));
        return;
      }
      const textInfo = (res.textCount > 0)
        ? PageSaverI18n.t('ui_95e8617030dd') + res.textCount + PageSaverI18n.t('ui_0e12850bb95d')
        : PageSaverI18n.t('ui_742a5113cc39');
      status.textContent = PageSaverI18n.t('ui_eabea83d2151') + res.filename + textInfo;
      if (res.textError) status.textContent += PageSaverI18n.t('ui_6d399ca3b507') + res.textError;
      if (res.preview) {
        img.style.display = 'block';
        img.src = res.preview;
        var dpi = (res.pixelWidth && res.width) ? Math.round(res.pixelWidth / (res.width * 0.75 / 72)) : 0;
        info.textContent = PageSaverI18n.t('ui_7e508bc7ae1c') + res.width + ' × ' + res.height + PageSaverI18n.t('ui_3537c06d5c06') +
          (res.pixelWidth || '?') + ' × ' + (res.pixelHeight || '?') + PageSaverI18n.t('ui_3fd2553f2612') +
          (dpi ? PageSaverI18n.t('ui_1a4e60391c93') + dpi + ' DPI）' : '') +
          (res.screens ? PageSaverI18n.t('ui_9d936f2e3725') + res.screens + PageSaverI18n.t('ui_3d022a62a5a1') : '');
      }
    } catch (e) {
      status.textContent = PageSaverI18n.t('ui_cfdcd1611998') + e.message + PageSaverI18n.t('ui_6144c57df49a');
    }
  }

  async function startPicker(mode) {
    status.textContent = PageSaverI18n.t('ui_dd4cf1c391b3');
    try {
      const res = await browser.runtime.sendMessage({ type: 'PICKER_START', mode: mode });
      if (!res || !res.ok) {
        status.textContent = PageSaverI18n.t('ui_63b9f7d618dc') + ((res && res.error) || PageSaverI18n.t('ui_13a46616e16f'));
        return;
      }
      window.close(); // 关闭 popup，交给页面
    } catch (e) {
      status.textContent = PageSaverI18n.t('ui_63b9f7d618dc') + e.message;
    }
  }

  // 「保存为完整 HTML 文件」：让后台转发到当前页面执行（进度条在页面上，关掉 popup 才看得见）
  async function saveFullHtml() {
    status.textContent = PageSaverI18n.t('ui_487254360080');
    try {
      const res = await browser.runtime.sendMessage({ type: 'HTML_SAVE_START' });
      if (!res || !res.ok) {
        status.textContent = PageSaverI18n.t('ui_63b9f7d618dc') + ((res && res.error) || PageSaverI18n.t('ui_13a46616e16f'));
        return;
      }
      window.close(); // 关闭 popup，把注意力交回页面上的进度条
    } catch (e) {
      status.textContent = PageSaverI18n.t('ui_63b9f7d618dc') + e.message + PageSaverI18n.t('ui_dd5f3a7e1fa2');
    }
  }

  document.getElementById('pdf').addEventListener('click', makeFullPagePdf);
  document.getElementById('pick-node').addEventListener('click', function () { startPicker('node'); });
  document.getElementById('pick-area').addEventListener('click', function () { startPicker('area'); });
  document.getElementById('save-html').addEventListener('click', saveFullHtml);

  // 「保存为 Markdown 文件」：只保留文章正文转 Markdown，保存到「下载」文件夹。
  async function saveMarkdown() {
    status.textContent = PageSaverI18n.t('ui_fa7f288f98ad');
    try {
      const res = await browser.runtime.sendMessage({ type: 'MARKDOWN_RUN_START' });
      if (!res || !res.ok) {
        status.textContent = PageSaverI18n.t('ui_63b9f7d618dc') + ((res && res.error) || PageSaverI18n.t('ui_13a46616e16f'));
        return;
      }
    } catch (e) {
      status.textContent = PageSaverI18n.t('ui_63b9f7d618dc') + e.message + PageSaverI18n.t('ui_dd5f3a7e1fa2');
    }
  }

  document.getElementById('save-md').addEventListener('click', saveMarkdown);

  // 整页截图改成手动触发（每次开 popup 自动渲染整页太慢，picker 才是主力）
  status.textContent = PageSaverI18n.t('ui_afc9b8992aea');
})();
