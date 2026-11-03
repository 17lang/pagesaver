# 保存设置的上游来源

修订：2；更新日期：2026-11-03。

上游：[Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper)
固定提交：`6d56d618b00bd970aa738d6a7a61edee27783e81`；MIT，完整许可见本目录 `LICENSE-obsidian-clipper.txt`。

| 本地文件 | 上游原件及复用范围 | 为 Pagesaver 做的适配 |
| --- | --- | --- |
| settings-section-ui.js | src/managers/settings-section-ui.ts：侧栏事件委托、section 显隐、active 状态 | 去掉 TypeScript 和无关模块依赖，仅 Markdown/PDF/HTML；加入键盘按钮及当前页属性 |
| settings.html | src/settings.html：settings/settings-container/sidebar/content、settings-section/setting-items 结构；template-vault、template-path-name 保存位置字段 | 中英文自动适配；只保留保存位置；添加 PDF/HTML 分类及绝对路径模式 |
| settings.css | src/styles/settings.scss 的设置布局与 setting-item 规则；src/styles/_sidebar.scss 的 sidebar/nav-list 规则 | Sass 嵌套改为浏览器原生 CSS 嵌套；补足独立运行所需颜色、控件和窄屏样式 |
| settings.js | 延用上游 template-vault 选择仓库、template-path-name 指定相对目录的交互与数据含义 | 使用本机工具读取已登记的仓库；检查通过才保存配置；统一服务三种格式 |

`destinations.js`、`native-save.js` 和 tools/native-helper 是补足浏览器任意绝对路径写入限制的新增部分，不称作上游代码。
Markdown 提取沿用项目已有的 Defuddle full 内核，本轮未更换其字节。

没有引入上游高亮、阅读器、AI 解释器、统计、评分、模板编辑器及对应脚本、样式、资源或权限。上游完整设置页不是运行依赖；仅吸收表中所列的保存相关片段。

0.6.0 为降低安装门槛，新增 `obsidian-save.js`：直接从同一提交的 `src/utils/obsidian-note-creator.ts` 复用 `obsidian://new?file=...`、`vault`、相对路径补斜杠及剪贴板传全文方式。去除模板、frontmatter、日记、追加/覆盖、统计及自动保存依赖，不引入高亮或阅读器。增加 clipboardWrite 权限；不读剪贴板。交接后只报告“已交给 Obsidian”，实际创建由 Obsidian 完成。

Markdown 可选默认下载、直接交给 Obsidian、原生绝对目录或原生仓库模式；PDF/HTML 原生模式仍统一通过工具写文件。直接模式填写仓库名称即可，无需读取 Obsidian 私有登记；跟随实际目录才需要原生工具解析。

修订记录：r2（2026-11-03）记录中英文适配及上游保存相关 URI/剪贴板复用。
