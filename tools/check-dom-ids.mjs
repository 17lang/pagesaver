// 静态自检：HTML 里被删掉/改名的元素 id，JS 是否还在取用。
//
// 为什么需要它：删掉一个按钮后如果忘了删 getElementById('xxx').addEventListener，
// node --check 完全查不出问题，扩展弹窗会直接白屏（null.addEventListener）。
// 这个检查器保证：JS 取用的每个 id，都能在同类 HTML 里找到。
//
// 用法：node tools/check-dom-ids.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// 目录 → 该目录下 HTML 与 JS 互为配对
const PAIRS = ['popup', 'options', 'preview'];

function idsIn(htmlFile) {
  const s = fs.readFileSync(htmlFile, 'utf-8');
  const ids = new Set();
  for (const m of s.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  return ids;
}

function jsFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith('.js')).map((f) => dir + '/' + f);
}

function htmlFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => f.endsWith('.html')).map((f) => dir + '/' + f);
}

let problems = 0;
let checked = 0;

for (const dir of PAIRS) {
  const htmls = htmlFiles(dir);
  if (!htmls.length) continue;

  // 同一目录下所有 HTML 的 id 并集（一个 JS 可能服务多个页面）
  const have = new Set();
  for (const h of htmls) for (const id of idsIn(path.join(ROOT, h))) have.add(id);

  for (const js of jsFiles(dir)) {
    const src = fs.readFileSync(path.join(ROOT, js), 'utf-8');
    const used = new Set();
    for (const m of src.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) used.add(m[1]);
    for (const m of src.matchAll(/querySelector(?:All)?\(\s*['"]#([A-Za-z][\w-]*)['"]/g)) used.add(m[1]);
    checked += used.size;
    const missing = [...used].filter((id) => !have.has(id));
    if (missing.length) {
      problems += missing.length;
      console.log(`❌ ${js}：取用了 HTML 里不存在的 id`);
      for (const id of missing) console.log(`     #${id}`);
    } else if (used.size) {
      console.log(`✅ ${js}：${used.size} 个 id 全部存在`);
    }
  }

  // 反向提示：HTML 里从未被任何 JS 使用的 id（只提示，不算错误）
  const allJs = jsFiles(dir).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf-8')).join('\n');
  const unused = [...have].filter((id) => !allJs.includes(`'${id}'`) && !allJs.includes(`"${id}"`) && !allJs.includes(`#${id}`));
  if (unused.length) console.log(`   （HTML 里没被 JS 引用：${unused.map((i) => '#' + i).join(', ')}）`);
}

console.log(problems ? `\n共 ${problems} 处 id 不匹配` : `\n全部通过：${checked} 个 id 引用都能对上`);
process.exitCode = problems ? 1 : 0;
