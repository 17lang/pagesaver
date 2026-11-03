# Third-party notices / 第三方说明

Pagesaver's own source is licensed under AGPL-3.0-or-later. Third-party works retain their original copyright and license. Runtime vendor bytes have not been changed in this release.

| Component | Fixed version | License | Source / official artifact |
| --- | --- | --- | --- |
| pdf-lib | 1.17.1 | MIT | [source](https://github.com/Hopding/pdf-lib/tree/v1.17.1) · [artifact](https://registry.npmjs.org/pdf-lib/-/pdf-lib-1.17.1.tgz) |
| @pdf-lib/fontkit | 1.1.1 | MIT | [source](https://registry.npmjs.org/@pdf-lib/fontkit/-/fontkit-1.1.1.tgz) · [artifact](https://registry.npmjs.org/@pdf-lib/fontkit/-/fontkit-1.1.1.tgz) |
| html-to-image | 1.11.11 | MIT | [source](https://github.com/bubkoo/html-to-image/tree/v1.11.11) · [artifact](https://registry.npmjs.org/html-to-image/-/html-to-image-1.11.11.tgz) |
| defuddle | 0.19.6 | MIT | [source](https://github.com/kepano/defuddle/tree/0.19.6) · [artifact](https://registry.npmjs.org/defuddle/-/defuddle-0.19.6.tgz) |
| SingleFile | 1.33.0 | AGPL-3.0-or-later | [source](https://github.com/gildas-lormeau/SingleFile/tree/v1.33.0) · [artifact](https://github.com/gildas-lormeau/SingleFile/releases/download/v1.33.0/singlefile-extension-firefox.zip) |
| Obsidian Web Clipper save-only settings and note handoff | 6d56d618b00bd970aa738d6a7a61edee27783e81 | MIT | [source](https://github.com/obsidianmd/obsidian-clipper/tree/6d56d618b00bd970aa738d6a7a61edee27783e81) |
| Noto Sans SC | bundled NotoSansSC-Regular.otf | SIL OFL 1.1 | [Noto CJK](https://github.com/notofonts/noto-cjk) |

Full license texts: [AGPL](LICENSE), [pdf-lib](licenses/pdf-lib-MIT.txt), [fontkit](licenses/fontkit-MIT.txt), [html-to-image](licenses/html-to-image-MIT.txt), [Defuddle](licenses/defuddle-MIT.txt), [Obsidian Clipper](options/LICENSE-obsidian-clipper.txt), [Noto](licenses/Noto-OFL.txt), [Apache 2.0 for embedded Microsoft helpers](licenses/Apache-2.0.txt).

SingleFile's distribution also contains upstream vendors; its complete source and their notices are in the linked official release/source. Defuddle full includes upstream Markdown parsing dependencies (including Turndown); see the linked versioned upstream source and its dependency notices. Do not remove upstream headers or notices when redistributing.

`lib/single-file.js` adds a readable Pagesaver sandbox bridge around the byte-identical upstream `tools/vendor/single-file.orig.js`; reproduce it with `node tools/wrap-kernel.mjs`. `lib/html-to-image.iife.js` similarly surrounds the unchanged official html-to-image UMD code with an explicit CommonJS bridge. The original is retained as `lib/html-to-image.js` in source, with the trailing source-map reference omitted inside the runtime bridge.

Exact SHA256 and verification against official artifacts are in [provenance.json](tools/vendor/provenance.json). The npm metadata for @pdf-lib/fontkit does not ship a license file; the MIT license text is taken from its upstream fontkit project. No proprietary Obsidian application code is included.

本项目不吸收 Clipper 的高亮、阅读器、AI 解释器或统计功能。保存相关代码的逐文件复用与适配见 [UPSTREAM](options/UPSTREAM.md)。

The fixed @pdf-lib/fontkit 1.1.1 package also contains the readable `dist/fontkit.umd.js`; this exact release artifact is used as its readable source reference because the upstream Git repository does not expose a matching 1.1.1 tag.
