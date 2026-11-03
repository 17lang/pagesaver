const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../options/destinations.js'), 'utf8'), context);
const D = context.PageSaverDestinations;
test('unconfigured formats keep browser download behavior', () => {
  const s = D.defaults();
  for (const kind of ['pdf', 'html', 'markdown']) assert.equal(D.target(s, kind), null);
  assert.equal(D.markdownReady(s), false);
});
test('three independent locations and live follow resolution', () => {
  const s = D.normalize({markdown:{mode:'absolute',path:'/tmp/Markdown'}, pdf:{mode:'absolute',path:'/tmp/PDF'},html:{mode:'markdown'}});
  assert.equal(D.target(s,'pdf').path,'/tmp/PDF');
  assert.equal(D.target(s,'html').path,'/tmp/Markdown');
  s.markdown.path='/tmp/changed';assert.equal(D.target(s,'html').path,'/tmp/changed');
});
test('incomplete Markdown cannot enable follow', () => {
  for (const markdown of [{mode:'default'}, {mode:'absolute',path:'relative'}, {mode:'vault',vault:''}, {mode:'vault',vault:'id',relativePath:'../escape'}]) {
    const s = D.normalize({markdown,pdf:{mode:'markdown'}});
    assert.equal(D.markdownReady(s),false);assert.throws(()=>D.target(s,'pdf'));
  }
});
test('vault mode preserves vault identity and relative path', () => {
  const s = D.normalize({markdown:{mode:'vault',vault:'stable-id',relativePath:'Clippings/中文'},pdf:{mode:'markdown'}});
  assert.equal(D.markdownReady(s),true);
  assert.equal(D.target(s,'pdf').vault,'stable-id');
  assert.equal(D.target(s,'pdf').relativePath,'Clippings/中文');
});
test('cross-platform path syntax and traversal rejected', () => {
  for(const p of ['/Users/a/网页','C:\\Users\\a\\网页','\\\\server\\share\\网页'])assert.equal(D.absolute(p),true);
  for(const p of ['relative','~/Downloads','/tmp/\x00bad'])assert.equal(D.absolute(p),false);
  for(const p of ['../bad','a/../b','C:\\bad','/bad','a\\..\\b'])assert.equal(D.relative(p),false);
});
