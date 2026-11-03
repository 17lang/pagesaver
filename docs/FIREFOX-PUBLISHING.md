# Firefox 市场发布准备

修订：1；核对日期：2026-11-03；候选：0.6.0。
状态：准备中，尚未提交 AMO；不代表 Mozilla 审核或签名通过。

## Owner 需要提供或完成

1. 用发布者的 Mozilla 账号注册或登录，访问 [AMO 开发者中心](https://addons.mozilla.org/developers/)，由账号持有人接受开发者协议。GitHub 登录不能替代 Mozilla 登录。
2. 确认公开作者显示名，当前材料按 `17lang` 准备。支持入口可直接用 GitHub Issues，无需公开个人邮箱。
3. 准备好后，可由账号持有人手动上传完整材料；若需要自动提交，需在 AMO 生成 API 凭据并保存在本机安全位置，不发到聊天、源码或公开仓库。API 凭据不是首次网页提交的必选材料。
4. 若要向普通用户正式分发 macOS 保存工具，建议使用 Owner 的 Apple Developer ID 签名及公证；当前没有相关签名身份。它不影响无需保存工具的默认下载方式，也不等于 AMO 必须收取 Apple 材料。

不要提供 Mozilla 密码、GitHub 令牌或 Apple 密钥到聊天或公开仓库。

## 开发侧准备的材料

- XPI：`manifest.json` 在包根，固定 ID 为 `pagesaver@pagesaver.local`。
- 完整可读的本项目源码、可重复构建脚本、第三方固定版本/官方原件链接/哈希、原许可。
- 中英文名称、摘要、详情、隐私说明、图标、截图、版本说明和审核说明。保存工具提供 helper-only ZIP，界面按钮直接下载。
- Firefox 内置数据声明：`websiteContent`、`browsingActivity`，原因是页面正文及原网址可能交给本机 Obsidian 或本机保存工具；没有开发者云端收集。最低桌面 Firefox 140。此处采用如实覆盖本机应用传递的声明，不把它误写为“完全无数据传递”。
- 默认保存无需额外工具；剪贴板和 Obsidian 外部应用调用在说明及界面中明确告知。高级目录保存工具单独下载，说明安装、卸载及审核方式。
- 不申请 Android 上架：截图 API、桌面目录及本机通道的行为没有 Android 验收。

## AMO 商品页草稿

**Name / 名称:** Pagesaver

**English summary:** Save pages as PDF, complete HTML or Markdown. Send articles to Obsidian.

**中文摘要：** 将网页保存为 PDF、完整 HTML 或 Markdown，也可把正文交给 Obsidian。

**English description:**

Save full pages or selected areas as single-page PDFs, archive pages with images and styles in one HTML file, or keep the article as Markdown. The interface follows your browser language (Chinese or English). Normal downloads need no companion app. Optional Obsidian handoff copies the article to your clipboard and opens your local Obsidian app; check Obsidian to confirm the note was created. Advanced automatic saving to arbitrary local folders needs a separately installed Pagesaver helper on each computer (macOS package provided). Page processing is local; HTML archiving requests resources from their original websites. No analytics or developer upload service. Browser-internal pages and AMO cannot be captured. Desktop Firefox only.

**中文详情：**

保存整页或选中区域为单页 PDF；将网页及图片、样式存入一个 HTML 文件；或仅保存正文为 Markdown。界面自动适配中文和英文，普通下载不需要安装其他程序。选择直接交给 Obsidian 时，会把正文复制到剪贴板并打开本机 Obsidian，请在 Obsidian 中确认结果。自动写入指定本机文件夹是高级选项，需要在每台电脑额外安装保存工具，目前提供 macOS 完整包。内容在本机处理；保存 HTML 会向资源原站发出请求。没有统计或开发者上传服务。浏览器内部页和 Firefox 市场页不可保存。仅桌面版 Firefox。

**License:** GNU AGPL v3 or later (third-party components retain their own licenses).

**Support / source:** https://github.com/17lang/pagesaver

**Support issues:** https://github.com/17lang/pagesaver/issues

**Privacy:** https://github.com/17lang/pagesaver/blob/main/PRIVACY.md

**Version notes:** Automatic Chinese/English UI; download-first setup; save-only Obsidian Clipper clipboard/URI handoff; advanced local locations retained. No Clipper highlighter or reader modules.

## 审核操作说明 / Notes for reviewers

1. Install on desktop Firefox 140+. Use an ordinary article page, not an internal browser page or AMO.
2. Default settings download PDF, HTML and Markdown through the browser. No native helper or Obsidian installation is needed for these three default routes.
3. Settings → Markdown → Send to Obsidian copies generated Markdown to the clipboard and opens an `obsidian://new?file=...&vault=...&clipboard` URI. It reuses the MIT upstream save-only implementation; no overwrite/append flag is set. This mode requires the user's Obsidian installation. App dispatch is reported as handoff, not confirmed file creation.
4. Optional advanced folder mode uses `app.pagesaver.save` Native Messaging. Full source is in `tools/native-helper/` (Go standard library only). Build it with `go build -trimpath -o pagesaver-save .`, run `./pagesaver-save --install` under an isolated user account, and choose a disposable directory in Settings. It reads local Obsidian registration only when requested and writes only the selected file destination. No server, daemon or network listener. Do not connect the automated test driver to your daily browser profile.
5. Third-party versions, original release artifacts and hashes are in `tools/vendor/provenance.json`; detailed sources/licenses are in `THIRD_PARTY_NOTICES.md`. First-party source is readable. SingleFile and html-to-image bridges wrap unchanged upstream UMD code to expose APIs in Firefox's content sandbox. They are reviewable in the source; do not classify the wrapper as a changed internal vendor implementation without inspecting it. Acceptance of this adaptation remains Mozilla's decision.
6. Build the XPI using Python 3.9+: `python3 tools/package-extension.py --output dist/pagesaver.xpi`. No npm installation or Go compiler is needed to package the extension. Fixed ZIP ordering/timestamps ensure reproducible bytes. To regenerate the existing SingleFile bridge, use Node and `node tools/wrap-kernel.mjs`.
7. Known validator warnings in the preflight run concern unchanged third-party `innerHTML`, dynamic import and fontkit eval/Function paths. Do not enable `unsafe-eval` or weaken page CSP to silence them. Warnings must be assessed by Mozilla; a local lint pass is not store approval.

## 官方要求及依据

- [提交扩展](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)：Mozilla 账号、开发者协议、XPI/ZIP（上限 200 MB）、选择“On this site”、验证、商品页及提交审核。隐私政策在向设备外发送数据时为必需；本项目仍主动提供本机处理和资源请求说明。
- [源码提交](https://extensionworkshop.com/documentation/publish/source-code-submission/)：对生成或压缩代码提供对应源码和可重复构建步骤，依赖构建时应提供锁文件。第三方官方原件另按第三方规则处理。
- [第三方库](https://extensionworkshop.com/documentation/publish/third-party-library-usage/)：提交固定发布版本的官方原件和可读源码链接；审核者会比较校验值。不能只链接会变化的 main 分支。
- [数据声明](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)：2025-11-03 起的新扩展必须采用内置数据声明，即使不收集数据也要声明；本项目包含本机应用传递，不能直接套用 none。
- [扩展政策](https://extensionworkshop.com/documentation/publish/add-on-policies/)：最小权限、自包含、不远程加载执行代码、原生应用传递同样受数据说明规则约束。页面提示 2026-12-01 将更新政策；若届时才提交，应重新核对生效版本。

## 材料是否必须

| 项目 | 说明 |
| --- | --- |
| Mozilla 开发者账号与协议 | 必需，账号持有人完成 |
| 可验证的 XPI、Manifest、版本和 ID | 必需 |
| 商品名、摘要、详情、许可及所需数据披露 | 必需 |
| 依要求提供源码、构建步骤、第三方固定链接 | 按代码形态必需，本项目主动准备 |
| 隐私政策 | 设备外数据传递时必需；本项目主动提供 |
| 审核测试步骤、额外依赖说明 | 涉及 Obsidian/本机工具的功能必须如实说明 |
| 图标与截图 | 商品页质量材料，已备图标并生成中英文截图；不把所有宣传图尺寸一律说成强制 |
| 支持邮箱 | 不必为此公开个人邮箱，可用 Issues URL |
| Apple Developer ID、公证 | 可选本机工具的正式分发事项，不是扩展 XPI 的 AMO 签名 |
| API key/secret | 手动首次提交不需要；自动提交时才需要 |

完成网页提交后，由 Mozilla 决定审核与签名。不能把“源码已公开”“本地验证无错误”写成“市场已发布”。
