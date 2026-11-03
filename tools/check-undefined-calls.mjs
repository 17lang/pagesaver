// 静态自检：找出「调用了但没定义」的函数引用。
//
// 为什么需要它：node --check 只查语法，查不出"把 A 改成 B 之后忘了改 C"这类未定义引用。
// 这个扩展连续两轮都栽在这上面（isOurNode → isOurButton 改名后漏改），
// 所以把它变成一道每次改动后都跑的自动检查。
//
// 用法：node tools/check-undefined-calls.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// 自动发现要检查的文件：别再手写清单（手写就会漏，overlay.js 就漏过一次）
function discover() {
  const list = ['background.js'];
  for (const dir of ['content', 'popup']) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).sort()) {
      if (f.endsWith('.js')) list.push(dir + '/' + f);
    }
  }
  return list;
}
const FILES = discover();

// 浏览器/语言内置的名字，不算未定义
const BUILTIN = new Set([
  'if','for','while','switch','catch','function','return','typeof','new','delete','void','await','yield',
  'do','else','try','throw','case','break','continue','instanceof','in','of','super','this','class',
  'extends','import','export','default','get','set','async','Promise','Array','Object','String','Number',
  'Boolean','Math','JSON','Date','RegExp','Error','TypeError','RangeError','SyntaxError','Map','Set',
  'WeakMap','WeakSet','Symbol','Proxy','Reflect','BigInt','parseInt','parseFloat','isNaN','isFinite',
  'encodeURIComponent','decodeURIComponent','setTimeout','clearTimeout','setInterval','clearInterval',
  'requestAnimationFrame','cancelAnimationFrame','fetch','console','window','document','globalThis',
  'navigator','location','history','alert','confirm','prompt','URL','Blob','File','FileReader','Image',
  'MouseEvent','WheelEvent','KeyboardEvent','MutationObserver','CustomEvent','Event','HTMLElement',
  'HTMLCanvasElement','HTMLImageElement','HTMLIFrameElement','HTMLVideoElement','HTMLTextAreaElement',
  'HTMLSelectElement','HTMLInputElement','SVGElement','Element','Node','Text','DOMParser','XMLSerializer',
  'structuredClone','queueMicrotask','Uint8Array','Int32Array','Float32Array','ArrayBuffer','DataView',
  'TextEncoder','TextDecoder','crypto','atob','btoa','chrome','browser','performance','self','top','parent',
  'frames','open','close','focus','blur','scroll','scrollTo','scrollBy','getComputedStyle','matchMedia',
  'postMessage','localStorage','sessionStorage','Notification','Audio','ImageData','Path2D','Audio','Image',
  'createImageBitmap','reportError','Function','eval','isFinite','decodeURI','encodeURI',
  'sendResponse','sendMessage','onMessage','addListener','removeListener',
  'XMLHttpRequest','Headers','Request','Response','AbortController','WebSocket','EventSource','EventTarget',
  // CSS 函数（写在样式字符串里的，不是真的调用）
  'rgba','rgb','hsl','hsla','translateX','translateY','translate','translateZ','scale','scaleX','scaleY',
  'rotate','rotateX','rotateY','rotateZ','skewX','skewY','calc','var','url','linear-gradient','radial-gradient',
  'conic-gradient','gradient','clamp','min','max','minmax','repeat','fit-content','cubic-bezier','steps','matrix',
  'perspective','inset','blur','drop-shadow','env','attr','counter','counters','format','local','leading',
  'progid','expression','rgb','currentColor','transparent'
]);

let problems = 0;

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log(`跳过（不存在）：${rel}`); continue; }
  // 注意：不要用正则去剔除字符串字面量——未闭合的引号会让正则一路吞掉后面大段代码，
  // 检查器会因此"什么都看不见"（哑掉）。CSS 函数改用白名单排除。
  const src = fs.readFileSync(file, 'utf-8');

  // 本文件里定义/声明的名字
  const defined = new Set();
  // 匿名函数 / 箭头函数的参数也算"已定义"（例如 new Promise(function (res, rej) {...}) 里的 rej）
  for (const m of src.matchAll(/function\s*\(([^)]*)\)/g)) {
    for (const part of m[1].split(',')) {
      const nm = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) defined.add(nm);
    }
  }
  for (const m of src.matchAll(/\(([^)]*)\)\s*=>/g)) {
    for (const part of m[1].split(',')) {
      const nm = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) defined.add(nm);
    }
  }
  for (const m of src.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
    defined.add(m[1]);
    for (const part of m[2].split(',')) {
      const nm = part.split('=')[0].trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(nm)) defined.add(nm);
    }
  }
  for (const m of src.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  for (const m of src.matchAll(/(?:var|let|const)\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.split(':').pop().trim().split('=')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) defined.add(name);
    }
  }
  // 其它文件里定义的名字（同扩展内共享作用域）
  for (const other of FILES) {
    if (other === rel) continue;
    const o = path.join(ROOT, other);
    if (!fs.existsSync(o)) continue;
    const os = fs.readFileSync(o, 'utf-8');
    for (const m of os.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) defined.add(m[1]);
    for (const m of os.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
  }

  // 调用点：用零宽负向后视判断"前面不是 . 也不是标识符字符"。
  // 注意：不能写成 /(^|[^.\w$])(...)/ —— 那个会消耗掉分隔符，
  // 导致 "if (foo(t))" 里的 foo 被吞掉、检查器变哑。
  const called = new Map();
  for (const m of src.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (BUILTIN.has(name)) continue;
    if (defined.has(name)) continue;
    called.set(name, (called.get(name) || 0) + 1);
  }

  if (called.size) {
    problems += called.size;
    console.log(`\n❌ ${rel}：这些名字被调用但没定义`);
    for (const [name, n] of called) console.log(`     ${name}()  ×${n}`);
  } else {
    console.log(`✅ ${rel}：没有未定义引用`);
  }
}

console.log(problems ? `\n共发现 ${problems} 处可疑未定义引用` : '\n全部通过：没有未定义引用');
process.exit(problems ? 1 : 0);
