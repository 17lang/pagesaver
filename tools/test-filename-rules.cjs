const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
for (const file of ['options/filename-rules.js', 'options/destinations.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
const N = context.PageSaverNaming;
test('handoff cases 1–12: stems, files, compounds and NFC', () => {
  for (const [input, expected] of [
    ['我是.你的  笑话.md', '我是.你的-笑话.md'], ['测试，，，符号。、— 名.md', '测试-符号-名.md'],
    ['，开头.md', '开头.md'], ['结尾，.md', '结尾.md'], ['？？？.md', ''],
    ['项目 说明.md', '项目-说明.md'], ['Cafe\u0301.md', 'Café.md'], ['图片.PNG', '图片.png'],
    ['架构图.excalidraw.md', '架构图.excalidraw.md']
  ]) assert.equal(N.purifyFileName(input), expected);
  assert.equal(N.purifyStem('调查 并治理：本机 Skill？'), '调查-并治理-本机-Skill');
  assert.equal(N.purifyStem('X0.clippings'), 'X0.clippings');
  assert.equal(N.purifyStem('A.B  C.D'), 'A.B-C.D');
});
test('handoff cases 13–16: published date and protected dots', () => {
  assert.equal(N.buildFileName('只有 4B 一个令人惊艳的国产 Agent 神器 开源了', '2026-09-05'), '2026-09-05-只有-4B-一个令人惊艳的国产-Agent-神器-开源了.md');
  assert.equal(N.purifyFileName('省下65%的钱 这个87K星的插件有点野.md'), '省下65-的钱-这个87K星的插件有点野.md');
  assert.equal(N.buildFileName('再见 draw.io！又一个神级 Skill 爆火，直接把代码仓库变成可交互架构图', '2026-09-18'), '2026-09-18-再见-draw.io-又一个神级-Skill-爆火-直接把代码仓库变成可交互架构图.md');
  assert.equal(N.normalizeDate('2026/09/22'), '2026-09-22');
  assert.equal(N.normalizeDate('2026-3-5'), '2026-03-05');
  assert.equal(N.normalizeDate('2026-13-45'), null);
});
test('date-last, no duplicate edge dates, full title and safe empty title', () => {
  assert.equal(N.buildFileName('draw.io Qwen3.8！', '2026-3-5', 'PDF', { datePosition: 'after' }), 'draw.io-Qwen3.8-2026-03-05.pdf');
  assert.equal(N.buildFileName('2025-01-02-旧标题', '2026-3-5'), '2025-01-02-旧标题.md');
  assert.equal(N.buildFileName('旧标题-2025-01-02', '2026-3-5'), '旧标题-2025-01-02.md');
  assert.equal(N.buildFileName('？？？', '2026-3-5'), '2026-03-05-未命名.md');
  assert.equal(N.buildFileName('.NET 教程', '2026-3-5'), '2026-03-05-.NET-教程.md');
  const long = '完整中文长标题'.repeat(30);
  assert.equal(N.buildFileName(long, '2026-3-5'), '2026-03-05-' + long + '.md');
});
test('missing date uses local calendar day; timestamp preserves publisher date', () => {
  const now = new Date(2026, 10, 6, 0, 5);
  assert.equal(N.buildFileName('文章', null, 'html', {}, now), '2026-11-06-文章.html');
  assert.equal(N.buildFileName('文章', '2026-09-22T23:30:00-12:00'), '2026-09-22-文章.md');
});
test('old settings default enabled; explicit off and date-last survive normalization', () => {
  const D = context.PageSaverDestinations;
  assert.equal(D.normalize({}).naming.enabled, true);
  assert.equal(D.normalize({}).naming.datePosition, 'before');
  const settings = D.normalize({ naming: { enabled: false, datePosition: 'after' }, markdown: { mode: 'absolute', path: '/tmp/Notes' } });
  assert.equal(settings.naming.enabled, false);
  assert.equal(settings.naming.datePosition, 'after');
  assert.equal(settings.markdown.path, '/tmp/Notes');
});
test('publication metadata ignores unrelated body dates and reads semantic metadata/JSON-LD', () => {
  function read(elements, scripts = []) {
    const ctx = vm.createContext({ PageSaverNaming: N, location: { hostname: 'example.org' },
      document: { querySelectorAll: selector => elements[selector] || [], scripts },
      browser: { runtime: { onMessage: { addListener() {} } } } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../content/page-metadata.js'), 'utf8'), ctx);
    return ctx.PageSaverPageMetadata.readPublishedDate();
  }
  assert.equal(read({}), null);
  const meta = { getAttribute: key => key === 'content' ? '2026/9/22' : null };
  assert.equal(read({ 'meta[property="article:published_time"]': [meta] }), '2026-09-22');
  assert.equal(read({ 'script[type="application/ld+json"]': [{ textContent: '{"@graph":[{"datePublished":"2026-3-5"}]}' }] }), '2026-03-05');
});
