#!/usr/bin/env node
// 生成 lib/single-file.js：把 SingleFile 内核（UMD）包装成 Firefox content script 安全可用。
//
// 为什么这么做：
//   SingleFile 内核是标准 UMD 包，靠「探测全局」决定把导出挂在哪：
//     - 有 exports/module        → 走 CommonJS 分支，把 getPageData/init/helper/SingleFile 直接挂到 exports
//     - 有 define.amd            → 走 AMD 分支
//     - 否则                     → 浏览器分支：UMD 外层先建 globalThis.singlefile={}，再把 API 挂到它
//   关键坑：CommonJS 分支下导出对象就是 exports 本身（含 getPageData 等），**没有 singlefile 子对象**；
//         singlefile 子对象只在浏览器分支才存在。所以桥接时要优先认 __exports 本身的 getPageData。
//
//   在 Firefox content script 沙箱里，globalThis/window 的探测不稳定（实测出现过「内核加载了但
//   window/globalThis 上读不到 singlefile」），导致报「HTML 处理内核未加载」。
//
// 策略：诱导 UMD 走 **CommonJS 分支**——
//   在 wrapper 内声明局部变量 exports/module（UMD 嵌套函数靠作用域链直接看到，比设置全局属性可靠），
//   UMD 就把 API 挂到 __exports，再显式桥接到 window.singlefile / globalThis.singlefile / self.singlefile。
//   全程不修改内核源码一行，只是外层包了一层「诱导 + 桥接」。
//
// 用法：node tools/wrap-kernel.mjs

import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcPath = join(root, 'tools/vendor/single-file.orig.js');
const outPath = join(root, 'lib/single-file.js');

const src = readFileSync(srcPath, 'utf8');

if (!src.includes('.singlefile={}')) {
  throw new Error('原始内核结构不匹配：找不到 singlefile 导出语句，拒绝生成');
}

const header = `/*! SingleFile core — 原样复用（AGPL-3.0，作者 Gildas Lormeau）
 *  本文件由 tools/wrap-kernel.mjs 自动生成，请勿手工编辑。
 *  wrap 只做两件事，内核源码一行未改：
 *    ① 诱导 UMD 走 CommonJS 分支（wrapper 局部变量 exports/module），把导出捕获到闭包；
 *    ② 显式桥接到 window.singlefile / globalThis.singlefile / self.singlefile，
 *       规避 Firefox content script 沙箱里 UMD 原生全局探测不稳定的问题。
 *  注：CommonJS 分支下导出对象就是 exports 本身（含 getPageData），没有 singlefile 子对象。
 */
`;

const footer = `\n/* ===== Pagesaver wrap：结束 ===== */\n`;

function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n');
}

const wrapper =
  header +
  `(function () {
  var __exports = {};
  var __module = { exports: __exports };
  // 用局部变量诱导 UMD 走 CommonJS 分支：UMD 嵌套函数靠作用域链直接看到它们，
  // 比「设置全局属性 g.exports」可靠（沙箱里全局属性设置不一定等价于标识符可见）。
  var exports = __exports;
  var module = __module;
  var __sf = null;
  try {
${indent(src, 4)}
  } catch (e) {
    try { window.__pagesaverKernelError = (e && e.message) || String(e); } catch (e2) { /* 忽略 */ }
  }
  // 修正：CommonJS 分支下导出就是 __exports 本身（含 getPageData），并无 singlefile 子对象；
  //      浏览器分支下导出在 __exports.singlefile / globalThis.singlefile。
  try {
    __sf = (typeof __exports.getPageData === 'function') ? __exports
         : (__exports.singlefile || (typeof globalThis !== 'undefined' ? globalThis.singlefile : undefined));
  } catch (e) {}
  if (__sf) {
    try { if (typeof window !== 'undefined') window.singlefile = __sf; } catch (e) {}
    try { if (typeof globalThis !== 'undefined') globalThis.singlefile = __sf; } catch (e) {}
    try { if (typeof self !== 'undefined') self.singlefile = __sf; } catch (e) {}
  }
})();
` + footer;

writeFileSync(outPath, wrapper, 'utf8');
console.log('已生成', outPath, '大小', (statSync(outPath).size / 1024).toFixed(0) + ' KB');
