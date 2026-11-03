/* Pagesaver save locations. Only extension pages may change these settings. */
(function (root) {
  'use strict';
  const KEY = 'pagesaverDestinations';
  function defaults() {
    return { pdf: { mode: 'default', path: '' }, html: { mode: 'default', path: '' },
      markdown: { mode: 'default', path: '', vault: '', vaultName: '', relativePath: '' } };
  }
  function normalize(input) {
    const out = defaults();
    for (const kind of Object.keys(out)) {
      const v = input && input[kind];
      if (!v) continue;
      const modes = kind === 'markdown' ? ['default', 'absolute', 'vault', 'obsidian'] : ['default', 'absolute', 'markdown'];
      if (!modes.includes(v.mode)) throw new Error((root.PageSaverI18n ? root.PageSaverI18n.t('ui_0451ecab35a0') : "请选择保存位置。"));
      out[kind].mode = v.mode;
      for (const field of Object.keys(out[kind])) {
        if (field !== 'mode') out[kind][field] = String(v[field] || '').trim();
      }
    }
    return out;
  }
  function absolute(path) {
    return /^(\/|[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(path) && !/[\x00-\x1f]/.test(path);
  }
  function relative(path) {
    return !/^[\\/]|^[A-Za-z]:|[\x00-\x1f]/.test(path) &&
      !path.split(/[\\/]/).some(part => part === '..' || part === '.');
  }
  function markdownReady(settings) {
    const m = settings.markdown;
    return m.mode === 'absolute' ? absolute(m.path) :
      (m.mode === 'vault' && !!m.vault || m.mode === 'obsidian' && !!m.vaultName) && relative(m.relativePath);
  }
  function target(settings, kind) {
    const value = settings[kind];
    if (!value) throw new Error((root.PageSaverI18n ? root.PageSaverI18n.t('ui_ab9dd17bdc0a') : "不支持这种文件。"));
    if (value.mode === 'default') return null;
    if (value.mode === 'markdown') {
      if (!markdownReady(settings)) throw new Error((root.PageSaverI18n ? root.PageSaverI18n.t('ui_88cf49959922') : "请先设置 Markdown 保存位置。"));
      return target(settings, 'markdown');
    }
    if (value.mode === 'absolute') {
      if (!absolute(value.path)) throw new Error((root.PageSaverI18n ? root.PageSaverI18n.t('ui_5d123cd3a476') : "请输入完整的文件夹路径。"));
      return { mode: 'absolute', path: value.path };
    }
    if (value.mode === 'obsidian') {
      if (!relative(value.relativePath) || /[\x00-\x1f]/.test(value.vaultName)) throw new Error(PageSaverI18n.t('ui_c34bb62fd90c'));
      return { mode: 'obsidian', vaultName: value.vaultName, relativePath: value.relativePath };
    }
    if (value.mode === 'vault') {
      if (!value.vault || !relative(value.relativePath)) throw new Error((root.PageSaverI18n ? root.PageSaverI18n.t('ui_adc31e99edb4') : "请选择仓库，并填写仓库内的文件夹。"));
      return { mode: 'vault', vault: value.vault, relativePath: value.relativePath };
    }
    throw new Error((root.PageSaverI18n ? root.PageSaverI18n.t('ui_0451ecab35a0') : "请选择保存位置。"));
  }
  async function load() {
    const data = await browser.storage.local.get(KEY);
    return normalize(data[KEY]);
  }
  root.PageSaverDestinations = { KEY, defaults, normalize, absolute, relative, markdownReady, target, load };
})(globalThis);
