/* Adapted from the Owner-supplied Filename Governor v0.4.4 handoff.
 * Titles are stems: keep embedded dots, NFC, Unicode letters/marks/numbers.
 */
(function (root) {
  'use strict';
  const COMPOUND_EXTENSIONS = ['.excalidraw.md', '.tar.bz2', '.tar.gz', '.tar.xz', '.d.cts', '.d.mts', '.d.ts', '.min.css', '.min.js'];
  const KEEP = /[\p{L}\p{M}\p{N}]/u;
  function purifyStem(stem) {
    const kept = [];
    let separatorPending = false;
    for (const character of String(stem).normalize('NFC')) {
      if (KEEP.test(character) || character === '.') {
        if (separatorPending && kept.length) kept.push('-');
        kept.push(character);
        separatorPending = false;
      } else {
        separatorPending = true;
      }
    }
    return kept.join('').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  }
  function safeExtension(extension) {
    return String(extension).normalize('NFC').toLowerCase().split('.')
      .map(part => part.replace(/[^a-z0-9-]+/gu, '')).filter(Boolean).join('.');
  }
  function splitFileName(name) {
    const compound = COMPOUND_EXTENSIONS.find(extension => name.toLowerCase().endsWith(extension));
    if (compound && name.length > compound.length) {
      return { stem: name.slice(0, -compound.length), extension: name.slice(1 - compound.length) };
    }
    const index = name.lastIndexOf('.');
    return index <= 0 || index === name.length - 1 ? { stem: name, extension: '' } :
      { stem: name.slice(0, index), extension: name.slice(index + 1) };
  }
  function purifyFileName(name) {
    const { stem, extension } = splitFileName(name);
    const body = purifyStem(stem), ext = safeExtension(extension);
    return body ? body + (ext ? '.' + ext : '') : '';
  }
  function normalizeDate(raw) {
    const match = String(raw || '').match(/\d{4}[/-]\d{1,2}[/-]\d{1,2}/u);
    if (!match) return null;
    const [year, month, day] = match[0].split(/[/-]/u).map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return [String(year).padStart(4, '0'), String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-');
  }
  function localDate(now) {
    return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  }
  function buildFileName(title, dateRaw, extension = 'md', options = {}, now = new Date()) {
    // Avoid hidden files and dot-only names without truncating a valid long title.
    const purified = purifyStem(title);
    const body = !purified || /^\.+$/u.test(purified) ? '未命名' : purified;
    const ext = safeExtension(extension);
    let stem = body;
    // A title with a date already at either edge keeps its existing date once.
    if (!/^\d{4}-\d{2}-\d{2}/u.test(body) && !/\d{4}-\d{2}-\d{2}$/u.test(body)) {
      const date = normalizeDate(dateRaw) || localDate(now);
      stem = options.datePosition === 'after' ? body + '-' + date : date + '-' + body;
    }
    return stem + (ext ? '.' + ext : '');
  }
  root.PageSaverNaming = { purifyStem, splitFileName, safeExtension, purifyFileName, normalizeDate, buildFileName };
})(globalThis);
