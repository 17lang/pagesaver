/* Vault + note location fields follow Obsidian Clipper's template settings.
 * Native path resolution replaces Obsidian URI dispatch so all formats share one writer. */
(async function () {
  'use strict';
  const D = PageSaverDestinations, N = PageSaverNative;
  const $ = id => document.getElementById(id);
  let persisted = await D.load(), busy = false;
  const status = $('settings-status');
  function readForm() {
    return D.normalize({
      naming: { enabled: $('normalize-filenames').checked, datePosition: $('filename-date-position').value },
      pdf: { mode: $('pdf-mode').value, path: $('pdf-path').value },
      html: { mode: $('html-mode').value, path: $('html-path').value },
      markdown: { mode: $('markdown-mode').value, path: $('markdown-path').value,
        vault: $('template-vault').value, vaultName: $('obsidian-vault-name').value, relativePath: $('template-path-name').value }
    });
  }
  function display() {
    const draft = readForm();
    $('naming-date-options').hidden = !draft.naming.enabled;
    // Follow becomes available only after a valid Markdown location is saved.
    const ready = D.markdownReady(persisted);
    for (const kind of ['pdf', 'html']) {
      $(kind + '-mode').querySelector('[value="markdown"]').disabled = !ready;
      $(kind + '-follow-hint').hidden = ready;
      $(kind + '-absolute').hidden = draft[kind].mode !== 'absolute';
    }
    $('markdown-absolute').hidden = draft.markdown.mode !== 'absolute';
    $('markdown-vault-fields').hidden = draft.markdown.mode !== 'vault';
    $('markdown-obsidian-fields').hidden = draft.markdown.mode !== 'obsidian';
    $('markdown-note-folder').hidden = !['vault', 'obsidian'].includes(draft.markdown.mode);
    $('helper-info').hidden = !['absolute','vault'].includes(draft.markdown.mode) &&
      !['pdf','html'].some(kind => ['absolute','markdown'].includes(draft[kind].mode));
  }
  function populate(settings) {
    $('normalize-filenames').checked = settings.naming.enabled;
    $('filename-date-position').value = settings.naming.datePosition;
    for (const kind of ['pdf', 'html', 'markdown']) {
      $(kind + '-mode').value = settings[kind].mode;
      $(kind + '-path').value = settings[kind].path;
    }
    const m = settings.markdown;
    if (m.vault && !$('template-vault').querySelector('option[value="' + CSS.escape(m.vault) + '"]')) {
      $('template-vault').add(new Option(PageSaverI18n.t('ui_44f345504327'), m.vault));
    }
    $('template-vault').value = m.vault;
    $('template-path-name').value = m.relativePath;
    $('obsidian-vault-name').value = m.vaultName;
    display();
  }
  async function refreshVaults() {
    $('refresh-vaults').disabled = true;
    const previous = $('template-vault').value;
    try {
      const response = await N.call({ action: 'vaults' });
      $('vault-install-help').hidden = true;
      $('template-vault').replaceChildren(new Option(PageSaverI18n.t('ui_3b6b54061cd2'), ''));
      for (const v of response.vaults.sort((a, b) => a.name.localeCompare(b.name))) {
        $('template-vault').add(new Option(v.name + ' — ' + v.path, v.id));
      }
      if (previous && !response.vaults.some(v => v.id === previous)) {
        $('template-vault').add(new Option(PageSaverI18n.t('ui_d93194542b2e'), previous));
      }
      $('template-vault').value = previous;
      $('vault-status').textContent = response.vaults.length ? '' : PageSaverI18n.t('ui_598a2dc0c6b9');
    } catch (e) { $('vault-status').textContent = e.message; $('vault-install-help').hidden = false; }
    finally { $('refresh-vaults').disabled = false; }
  }
  populate(persisted);
  $('save-settings-form').addEventListener('input', () => { if (!busy) { status.textContent = PageSaverI18n.t('ui_520b00e114f7'); display(); } });
  $('save-settings-form').addEventListener('change', () => { if (!busy) display(); });
  $('refresh-vaults').addEventListener('click', refreshVaults);
  $('check-helper').addEventListener('click', async () => {
    $('check-helper').disabled = true;
    try { await N.call({ action: 'ping' }); $('helper-status').textContent = PageSaverI18n.t('ui_5be0323e8adc'); }
    catch (e) { $('helper-status').textContent = e.message; }
    finally { $('check-helper').disabled = false; }
  });
  $('save-settings-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    busy = true;
    // Lock editing during validation so the checked snapshot is exactly what gets saved.
    const controls = [...$('save-settings-form').querySelectorAll('input, select, button')];
    const originalDisabled = controls.map(c => c.disabled);
    try {
      const draft = readForm(); controls.forEach(c => { c.disabled = true; }); status.textContent = PageSaverI18n.t('ui_6503e4a9ba63');
      for (const kind of ['markdown', 'pdf', 'html']) {
        const target = D.target(draft, kind);
        const unchanged = JSON.stringify(draft[kind]) === JSON.stringify(persisted[kind]) &&
          (draft[kind].mode !== 'markdown' || JSON.stringify(draft.markdown) === JSON.stringify(persisted.markdown));
        if (target && !unchanged && !(kind === 'markdown' && target.mode === 'obsidian')) {
          const nativeTarget = await PageSaverObsidian.nativeTarget(target);
          await N.call({ action: 'check', target: nativeTarget });
        }
      }
      await browser.storage.local.set({ [D.KEY]: draft });
      persisted = draft; status.textContent = PageSaverI18n.t('ui_1bd91a7d0c53');
    } catch (e) { status.textContent = e.message; }
    finally {
      controls.forEach((c, i) => { c.disabled = originalDisabled[i]; }); busy = false; display();
    }
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[D.KEY] && !busy) {
      const next = D.normalize(changes[D.KEY].newValue);
      if (JSON.stringify(next) === JSON.stringify(persisted)) return;
      persisted = next; display();
      status.textContent = PageSaverI18n.t('ui_243f0add630c');
    }
  });
  // Do not require or contact the helper for the default or direct Obsidian flow.
})();
