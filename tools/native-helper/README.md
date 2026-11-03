# Pagesaver 本机保存工具

修订：1；更新日期：2026-11-03；版本：0.5.0。

只使用 Go 标准库。没有联网、监听端口、启动项或常驻服务。浏览器通过 Native Messaging 按需启动，每次保存结束关闭连接。

普通浏览器下载及直接交给 Obsidian 不需要安装此工具。每台电脑只有使用高级目录时才安装一次。

## 构建与安装

Go 1.23 或更新版本；本轮实际构建版本见交付验证报告。

```sh
go test -race ./...
go vet ./...
go build -trimpath -ldflags '-s -w' -o pagesaver-save .
./pagesaver-save --install
```

用户安装包附带已编译的 macOS 通用二进制，不需要安装 Go。`--install` 仅登记当前用户的 Pagesaver 保存工具，不安装系统服务。macOS 安装到 `~/Library/Application Support/Pagesaver/`，原生通道清单登记到当前用户的 Mozilla 和 Zen NativeMessagingHosts 目录。重复安装替换自有程序及自有清单，遇到路径相同但归属不同的清单拒绝覆盖。Windows 当前安装器遇到已安装程序会明确要求移走旧程序后再装。

固定扩展 ID：`pagesaver@pagesaver.local`；本机通道名：`app.pagesaver.save`。只接受此扩展 ID。

## 协议与边界

浏览器原生通道的 4 字节小端长度 + JSON；单请求不超过 384 KiB。
`ping` 检查版本；`vaults` 只读 Obsidian 仓库登记；`check` 校验目录并创建后立即删除权限探针。
`begin` 指定文件名、目标及字节数；`chunk` 按序传送不超过 192 KiB 的 base64 原始块；`commit` 校验总字节数、同步临时文件，并通过不覆盖已有文件的硬链接发布完整文件。
同名自动编号，断连或错误会清理未发布的临时文件。总文件上限 512 MiB。磁盘或同步软件不支持硬链接时明确报错，不退化为覆盖写入。

绝对路径必须是本系统的现有文件夹。仓库模式读取本系统 Obsidian 配置中的稳定仓库 ID 和实际路径，相对目录可为空；非空目录保存时创建。拒绝 `..`、绝对相对路径及现有符号链接跳出仓库。防护面向扩展请求，不声称能抵御同时有本地文件修改权限的恶意进程竞态。

跨平台：核心保存代码共用；macOS、Windows、Linux 分别采用官方 Native Messaging 注册位置和本系统 Obsidian 配置位置。macOS 为实际验证平台，其他平台仅做交叉编译，不声称运行验收通过。

## 验证入口

- 路径规则：`node --test tools/test-destinations.cjs`（源码仓根）。
- 工具：本目录 `go test -race -v ./...`、`go vet ./...`。
- Zen：在独立临时 profile 启动浏览器，配置 `marionette.port=2829`，环境设置 `MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1`，传入 `-headless -no-remote -profile <临时路径> --marionette`。
- 安装开发测试依赖 `marionette_driver` 后执行 `python tools/test-zen.py --output <空的测试输出目录>`。也可用 `python tools/run-zen-verification.py --binary /path/to/zen --output <空输出目录>` 自动启动并关闭隔离浏览器。脚本只能连接隔离的测试浏览器，会清空该测试扩展的保存设置；不得连接日常使用的 profile。脚本写入自有样本和截图，不写真实仓库笔记。

产品定义及界面规则见 [保存位置设置](../../README.zh-CN.md#高级选项自动保存到指定文件夹)；技术与测试关系见 [公开实现说明](../../docs/ARCHITECTURE.md)。
