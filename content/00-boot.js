// 必须第一个加载：捕获 content script 初始化阶段的报错。
// 这样万一某个库没挂上，我们能在界面上显示"确切原因"，而不是只看到 undefined。
(function () {
  window.__joppBootErrors = [];

  window.addEventListener('error', function (e) {
    try {
      var msg = e.message || (e.error && e.error.message) || PageSaverI18n.t('ui_13a46616e16f');
      var where = e.filename ? ' @ ' + String(e.filename).split('/').pop() + ':' + (e.lineno || 0) : '';
      window.__joppBootErrors.push(msg + where);
    } catch (x) { /* 忽略 */ }
  });

  window.addEventListener('unhandledrejection', function (e) {
    try {
      var r = e.reason;
      window.__joppBootErrors.push(PageSaverI18n.t('ui_e498787a1115') + ((r && r.message) || r));
    } catch (x) { /* 忽略 */ }
  });
})();
