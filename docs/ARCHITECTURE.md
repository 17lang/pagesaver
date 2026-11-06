# Pagesaver 实现说明

修订：3；适用版本：0.7.1；日期：2026-11-06。

## 保存与界面

产品与交互见 README / README.zh-CN.md；验证见 VERIFICATION.md。

- `popup/`：三格式入口、选区操作、右上角设置齿轮。
- `options/settings.*`：沿用 Clipper 的保存设置侧栏；只保留 Markdown/PDF/HTML。
- `_locales/{en,zh_CN,zh_TW}/messages.json` 与 `i18n.js`：Firefox 标准 i18n；英文默认，中文浏览器使用中文。只翻译扩展自己的页面、提示和菜单，绝不改写用户网页或待保存正文。原生工具返回的稳定错误在浏览器侧翻译。
- `content/`：页面截图准备、选区、文字提取、HTML/Markdown 引擎调用、保存进度。扩展浮层在截图前隐藏。
- `background.js`：浏览器截图拼接、pdf-lib 单页 PDF、原生/浏览器下载分流。非常驻后台，配置在 storage.local。

产品入口与体验：[开始使用](../README.zh-CN.md#开始使用)。

## 三条保存路线

`options/destinations.js` 存三种独立目标，沿用原 storage key。旧版 absolute/vault/markdown 配置保留；新增 markdown.obsidian 与 vaultName，不自动迁移或覆盖旧路径。

1. `default`：浏览器下载 API，三格式无需保存工具。重名使用浏览器 uniquify。
2. Markdown `obsidian`：`options/obsidian-save.js` 复用 MIT Clipper 的 new-note URI、仓库、相对路径和剪贴板写入逻辑。剪贴板放全文，URI 不携带长正文；不设置 overwrite/append。不引入模板、统计、高亮、阅读器或解释器。后台返回 handedOff，页面提示要求在 Obsidian 确认。剪贴板失败不触发空笔记，不伪报保存完成。
3. `absolute` 或旧 `vault`：按需连接本机保存工具。PDF/HTML 跟随 Markdown 时解析当前配置；若 Markdown 为直接 Obsidian 模式，需先填写仓库名称，之后通过工具读取实际仓库目录。发现同名仓库拒绝猜测，要求指定路径。

设置只在保存后解锁跟随；直接 Obsidian 可以使用当前仓库，但未填写仓库名称时不能让 PDF/HTML 跟随，因为扩展不知道当前仓库的磁盘位置。保存配置时对原生目标检查路径和写入权限；直接 Obsidian 只检查名称/相对路径语法，不调用工具。

默认设置和直接 Obsidian 不主动查仓库或连接工具。高级设置才显示安装步骤及直接下载链接：
`https://github.com/17lang/pagesaver/releases/latest/download/pagesaver-save-macos.zip`。

交接方式的产品说明：[Markdown 直接交给 Obsidian](../README.zh-CN.md#直接交给笔记)。

## 本机工具

`tools/native-helper/` 使用 Go 标准库，通过浏览器 Native Messaging 的长度前缀 JSON 工作，不监听网络、不安装常驻服务。固定扩展 ID 为 `pagesaver@pagesaver.local`，工具名为 `app.pagesaver.save`。

协议：ping/vaults/check/begin/chunk/commit。192 KiB 原始块，512 MiB 文件上限；校验完整字节数后同步临时文件，再通过不覆盖的硬链接发布，重名编号。断连清理未发布临时文件。仓库目录拒绝 `..` 和符号链接越界；不承诺抵抗拥有本机目录写权限的恶意并发进程。

每台电脑安装一次，不能把另一台电脑的登记或仓库 ID 当作当前机器的配置。核心代码跨平台，当前安装包及运行验收以 macOS 为范围；其他系统源码提供但未验收。

## 构建与发布

`tools/package-extension.py` 只打包运行文件，固定 ZIP 顺序与时间戳，不包含测试网页、开发工具、用户文件或个人接手记录。`tools/build-release.py` 复用它构建完整 macOS 包，源码包采用明确公开清单。

第三方原件核验见 tools/vendor/provenance.json；许可见 THIRD_PARTY_NOTICES.md。Firefox 市场材料和政策链接见 FIREFOX-PUBLISHING.md。签名、商店审核、代码公开与实际用户验收分别记录。

## 发布前检查

0.6.0 运行包通过 web-ext 预检：0 错误、10 条警告。警告涉及桌面与 Android 数据声明版本差异、原样第三方库的 innerHTML / import / eval；Android 不在申报范围，第三方原件和来源可由 Mozilla 审核。未放宽 CSP 或启用 unsafe-eval。两次固定打包结果逐字节一致。

## 自动规范命名

options/filename-rules.js 提供纯命名规则。content/page-metadata.js 从文章元数据、JSON-LD 和公众号字段提取发布日期。background.saveFile 在读取同一份目录/命名配置后构建最终名称，供 downloads、Native Messaging、Obsidian 三条路线共用，覆盖整页与选区 PDF。关闭后使用原先文件名构建方式。

配置 normalize 对旧数据补 naming 默认值，设置保存只对发生变化的原生目录检查写入，避免只改命名仍要求连接旧目录的保存工具。命名规则、日期回退差异与验证入口详见 [自动规范文件名](FILENAME-RULES.md)。


## 内嵌页面整页截图与设置图标

0.7.1 修复：若外层文档不滚动，且唯一可匹配的 iframe 从窗口左上角铺满视口，整页 PDF 使用同一套截图协议滚动其内部文档。通过现有 `<all_urls>` 权限与 `tabs.executeScript(allFrames)` 进入跨域 frame，不新增权限、不下载或改写正文。普通页面、部分窗口 iframe 和手动选区保留原路径。不会打开折叠内容或点击链接。

`content/capture.js` 公开隔离世界内的 `joppNativeCapture`，防止重复注入；测量全屏 iframe 地址，准备、滚动及恢复沿用原实现。`background.js#captureAndStitch` 只在唯一匹配且内部更长时切换；所有滚动截图完成或报错后恢复 frame 和外层的滚动位置、样式及浮层。不能访问的 frame 仍保留外层截图行为，不宣称其隐藏部分已捕获。当前只支持一级全屏 iframe，不泛化为任意嵌套滚动面板。此路线不新增内嵌文档的 PDF 文字层；画面完整与可搜索文字分别验证。

齿轮修复：`popup/popup.html` 的 SVG circle/path 使用显式闭合标签，并保持 `viewBox` 大小写。此前 HTML 本地化过程使 path 嵌入 circle，实际只显示中心圆；浏览器定向检查覆盖 path 是 svg 直接子节点、实际外圈宽度、设置名称、右上角位置与点击打开设置。

回归入口：`tools/test-zen-frames.py`（通过 `tools/run-zen-verification.py` 启动隔离浏览器），跨源 2400px 四色页面完整保存、多屏截图后恢复原滚动位置。普通保存回归见 `tools/test-zen.py`；本轮结果见 [验证](VERIFICATION.md#071-内嵌页面与齿轮修复)。

本轮 Node 规则检查共 15 项通过；普通保存浏览器回归 20 项及新增内嵌页面 2 项通过，另完成齿轮渲染和点击检查。
