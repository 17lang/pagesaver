# Pagesaver

[English](README.md)

把整页或选中区域保存为单页 PDF；把网页保存为一个完整 HTML；把文章正文保存为 Markdown。适用于桌面 Firefox 140 及以上版本和 Zen。

## 开始使用

安装扩展后，直接选择保存方式。**普通下载不需要安装其他工具**，文件使用浏览器的下载位置。

界面随浏览器自动切换中文或英文，其他语言显示英文。Firefox 市场上架材料正在准备中；审核通过前，在 Releases 下载 `pagesaver.xpi`，到 `about:debugging#/runtime/this-firefox` 临时加载。浏览器重启后需要重新加载开发版。

对应[界面与保存实现](docs/ARCHITECTURE.md#保存与界面)，开发验证见[验证记录](docs/VERIFICATION.md)。

## 直接交给笔记

在“设置 → Markdown”选择“交给 Obsidian”，填写 Obsidian 中显示的仓库名称，也可以留空使用当前仓库。按需填写仓库内文件夹，再保存设置。

此方式只需要已安装的 Obsidian，不需要 Pagesaver 保存工具。复用原版 Obsidian Web Clipper 的保存代码：把正文复制到剪贴板，再打开 Obsidian。浏览器可能询问是否允许打开应用。请在 Obsidian 中确认笔记已创建，扩展不能确认其他应用的实际写入结果。不会主动要求覆盖已有笔记。

对应[交接路线实现](docs/ARCHITECTURE.md#三条保存路线)。

## 高级选项：自动保存到指定文件夹

只有需要写入任意本机文件夹，或让 PDF/HTML 自动跟随 Markdown 的实际文件夹时，才需要额外安装保存工具。**每台电脑各安装一次**。当前 macOS 完整包支持 Apple 芯片和 Intel Mac：

1. [下载 Mac 保存工具](https://github.com/17lang/pagesaver/releases/latest/download/pagesaver-save-macos.zip)，然后解压。
2. 双击“安装保存工具.command”。
3. 在设置中选择指定目录或高级 Obsidian 文件夹方式，点击“检查连接”；需要仓库列表时再点“刷新仓库”。

三种格式分别设置。跟随“交给 Obsidian”时，需填写仓库名称；同名仓库需改用指定文件夹。同名文件自动编号，不覆盖；指定位置不可用时会报错。

工具只在保存时运行，不常驻、不监听端口、不上传云端。当前工具为开发包，采用本地签名，未做 Apple 公证。Windows/Linux 提供源码，尚未完成实际系统验收和面向普通用户的安装包。

## 隐私与限制

网页在本机处理。保存完整 HTML 时，会向资源原站请求图片、字体等。Obsidian 方式使用本机剪贴板并打开应用；保存工具仅接收待保存内容并写入本机文件夹。没有统计、广告或开发者上传服务器，详见[隐私说明](PRIVACY.md)。

浏览器内部页和 Firefox 市场页不允许扩展读取。超长、复杂页面和视频存档存在兼容边界。PDF 沿用截图和 pdf-lib，尽量附加可搜索文字；HTML 沿用 SingleFile；Markdown 沿用 Defuddle。不包含 Obsidian Clipper 的高亮、阅读器或 AI 功能。

## 开发与许可

构建和测试命令见[英文说明](README.md#build-and-test)。整个项目按 **AGPL-3.0-or-later** 开源，第三方保留各自许可，见[第三方说明](THIRD_PARTY_NOTICES.md)。问题反馈使用本仓库 Issues，请勿上传私人网页、仓库路径或凭据。

## 当前验证

0.6.0 已完成中英文界面、20 项三格式保存回归、4 项首次使用及 9 项规则检查；Firefox 市场尚未提交，直接交给 Obsidian 的真实建笔记结果需在应用中确认。详见[验证记录](docs/VERIFICATION.md)。

## 自动规范文件名

默认把文件名改为“发布日期-净化后的完整标题”，空格、标点、表情统一成短横线，保留文字、数字和英文句点。发布日期取不到时用当天日期。可在“设置 → 文件命名”选择时间在后或关闭。详见[命名规范](docs/FILENAME-RULES.md)。
