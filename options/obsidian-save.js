/* Adapted from Obsidian Web Clipper, MIT.
 * src/utils/obsidian-note-creator.ts @ 6d56d618b00bd970aa738d6a7a61edee27783e81
 * Retains new-note URI, relative folder, vault, and clipboard transfer only.
 */
(function (root) {
  'use strict';
  function makeUrl(filename, target) {
    let path = target.relativePath.replace(/\\/g, '/');
    if (path && !path.endsWith('/')) path += '/';
    let url = 'obsidian://new?file=' + encodeURIComponent(path + filename.replace(/\.md$/i, ''));
    if (target.vaultName) url += '&vault=' + encodeURIComponent(target.vaultName);
    // No overwrite or append flag: keep Obsidian's normal new-note behavior.
    return url + '&clipboard';
  }
  async function save(blob, filename, target) {
    try { await navigator.clipboard.writeText(await blob.text()); }
    catch (e) { throw new Error(PageSaverI18n.t('ui_cb511d888d6f')); }
    await browser.tabs.create({ url: makeUrl(filename, target) });
    // External app dispatch is not a receipt that Obsidian wrote the file.
    return { filename, handedOff: true };
  }
  async function nativeTarget(target) {
    if (target.mode !== 'obsidian') return target;
    if (!target.vaultName) throw new Error(PageSaverI18n.t('ui_648e42318c16'));
    const { vaults } = await PageSaverNative.call({ action: 'vaults' });
    const matches = vaults.filter(v => v.name === target.vaultName);
    if (matches.length > 1) throw new Error(PageSaverI18n.t('ui_ecff1a1ff276'));
    if (!matches.length) throw new Error(PageSaverI18n.source('找不到这个仓库，请重新选择。'));
    return { mode: 'vault', vault: matches[0].id, relativePath: target.relativePath };
  }
  root.PageSaverObsidian = { makeUrl, save, nativeTarget };
})(globalThis);
