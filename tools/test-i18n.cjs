const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function context(locale) {
  const messages = JSON.parse(fs.readFileSync(path.join(root, '_locales', locale, 'messages.json')));
  const calls = { urls: [], clipboard: [] };
  const ctx = vm.createContext({ browser: {
    i18n: { getMessage: key => messages[key]?.message || '' },
    tabs: { create: async args => calls.urls.push(args.url) },
  }, navigator: { clipboard: { writeText: async value => calls.clipboard.push(value) } } });
  for (const name of ['i18n.js','options/destinations.js','options/obsidian-save.js']) vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),ctx);
  return { ctx, calls, messages };
}
test('all catalogs cover the same messages; translated helper errors and language fallback', () => {
  const en = context('en'), cn = context('zh_CN'), tw = context('zh_TW');
  assert.deepEqual(Object.keys(en.messages).sort(),Object.keys(cn.messages).sort());
  assert.deepEqual(Object.keys(en.messages).sort(),Object.keys(tw.messages).sort());
  assert.equal(en.ctx.PageSaverI18n.source('设置'),'Settings');
  assert.equal(cn.ctx.PageSaverI18n.source('设置'),'设置');
  assert.equal(en.ctx.PageSaverI18n.source('文件夹不存在或无法访问，请检查路径。'),'Folder missing or inaccessible. Check the path.');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  assert.equal(manifest.default_locale,'en');
});
test('direct Obsidian uses upstream clipboard and encoded new-note URI without overwrite',async()=>{
  const {ctx,calls}=context('en');
  const body='# Article\n\n中文🙂'.repeat(10000);
  const target={mode:'obsidian',vaultName:'My vault & 中文',relativePath:'Inbox/文章'};
  const result=await ctx.PageSaverObsidian.save({text:async()=>body},'A & B.md',target);
  assert.deepEqual(calls.clipboard,[body]);
  const url=new URL(calls.urls[0]);
  assert.equal(url.protocol,'obsidian:');assert.equal(url.hostname,'new');
  assert.equal(url.searchParams.get('vault'),target.vaultName);
  assert.equal(url.searchParams.get('file'),'Inbox/文章/A & B');
  assert.ok(url.searchParams.has('clipboard'));
  assert.ok(!url.searchParams.has('overwrite'));
  assert.equal(result.handedOff,true);
});
test('clipboard failure does not claim saving or launch an empty note',async()=>{
  const {ctx,calls}=context('en');ctx.navigator.clipboard.writeText=async()=>{throw Error('denied')};
  await assert.rejects(ctx.PageSaverObsidian.save({text:async()=>''},'a.md',{relativePath:''}),/Could not copy/);
  assert.equal(calls.urls.length,0);
});
test('direct Obsidian validates relative paths and following requires a named vault',()=>{
  const {ctx}=context('en'),D=ctx.PageSaverDestinations;
  let s=D.normalize({markdown:{mode:'obsidian',relativePath:'Inbox'}});
  assert.equal(D.target(s,'markdown').mode,'obsidian');assert.equal(D.markdownReady(s),false);
  s.markdown.vaultName='Notes';assert.equal(D.markdownReady(s),true);
  s.pdf.mode='markdown';assert.equal(D.target(s,'pdf').vaultName,'Notes');
  s.markdown.relativePath='../outside';assert.throws(()=>D.target(s,'markdown'));
});
