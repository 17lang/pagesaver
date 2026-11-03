"""Build a macOS development installation bundle without modifying old release archives."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import sys
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--go', default='go')
parser.add_argument('--output', required=True)
parser.add_argument('--report')
parser.add_argument('--evidence-dir')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
version = json.loads((root / 'manifest.json').read_text())['version']
out = Path(args.output).resolve()
out.mkdir(parents=True, exist_ok=False)

def run(argv, **kwargs):
    subprocess.run(argv, check=True, **kwargs)

def archive(path, entries):
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(entries):
            if p.is_file() and p.name != '.DS_Store':
                z.write(p, p.relative_to(root))

run([sys.executable, str(root / 'tools/package-extension.py'), '--output', str(out / 'pagesaver.xpi')])
public_dirs = {'content', 'icons', 'lib', 'options', 'popup', 'tools', '_locales', 'licenses', 'docs'}
public_files = {'manifest.json', 'background.js', 'i18n.js', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'README.zh-CN.md', 'PRIVACY.md', '.gitignore'}
source_entries = [p for p in root.rglob('*') if p.is_file() and (p.relative_to(root).parts[0] in public_dirs or p.relative_to(root).as_posix() in public_files) and not any(part in {'.git', '__pycache__', '.DS_Store'} for part in p.relative_to(root).parts)]
archive(out / 'pagesaver-source.zip', source_entries)
with tempfile.TemporaryDirectory(prefix='pagesaver-release-') as tmp:
    binaries = []
    for arch in ['arm64', 'amd64']:
        binary = Path(tmp) / arch
        env = dict(os.environ, CGO_ENABLED='0', GOOS='darwin', GOARCH=arch)
        run([args.go, 'build', '-trimpath', '-ldflags', '-s -w', '-o', str(binary), '.'], cwd=root / 'tools/native-helper', env=env)
        binaries.append(str(binary))
    run(['lipo', '-create', *binaries, '-output', str(out / 'pagesaver-save')])
    run(['codesign', '-s', '-', '--force', str(out / 'pagesaver-save')])
installer = out / '安装保存工具.command'
installer.write_text('''#!/bin/zsh
set -eu
cd -- "${0:A:h}"
./pagesaver-save --install
print "安装完成。请打开 Pagesaver 设置，点击‘检查连接’。"
read "?按回车关闭窗口。"
''')
installer.chmod(0o755)
(out / '安装说明.md').write_text('''# Pagesaver 安装说明

版本：''' + version + '''；适用：Apple 芯片和 Intel Mac 上的 Zen / Firefox。

普通下载和“交给 Obsidian”方式无需安装保存工具。只有选择本机文件夹、读取仓库列表或让 PDF/HTML 跟随实际目录时，才需要以下第 1 步；每台电脑各安装一次。

1. 需要保存工具时，先解压整个安装包，双击“安装保存工具.command”，看到“已安装”。只需安装一次；不需要 Go、Python、管理员密码或常驻服务。
2. 在 Zen 打开 `about:debugging#/runtime/this-firefox`，点“临时载入附加组件”，选择包里的 `pagesaver.xpi`。
3. 打开 Pagesaver → 设置 → 检查连接，应显示“已连接”。
4. 先设置并保存 Markdown 的位置，再按需设置 PDF、HTML。指定文件夹时输入现有文件夹的完整路径；仓库内的子文件夹可在保存时自动创建。
5. 刷新要保存的网页，再执行保存。PDF、HTML 可分别指定位置，也可跟随 Markdown。重名自动编号。

尚未配置的格式继续保存到浏览器下载位置。已配置的位置不可用时明确报错，不会悄悄改存下载文件夹。改动设置后需要点击“保存设置”。

这是开发安装包。扩展尚未经过 AMO 签名，临时加载在重启浏览器后需要重新执行第 2 步；不代表可永久安装或已获商店发布批准。本机程序采用本地临时签名，未做 Apple 公证；若系统阻止打开，请将提示原文交给开发方确认，不需要关闭系统安全功能。

源码在 `pagesaver-source.zip`；上游复用范围和许可见源码 `options/UPSTREAM.md` 与 `options/LICENSE-obsidian-clipper.txt`。完整 HTML 内核沿用原项目 SingleFile。验证结果见同包 `验证结果.md`。

卸载本机保存工具：先不再使用扩展保存，再删除 `~/Library/Application Support/Pagesaver/pagesaver-save` 以及 Mozilla、Zen 的 `NativeMessagingHosts/app.pagesaver.save.json` 两份专属登记文件；不删除其他工具的配置。已保存的页面不受影响。
''')
if args.report:
    shutil.copyfile(args.report, out / '验证结果.md')
if args.evidence_dir:
    evidence = Path(args.evidence_dir)
    for name in ['settings-markdown.png', 'settings-pdf.png', 'pdf-preview.png', 'zen-results.json']:
        if (evidence / name).is_file():
            shutil.copyfile(evidence / name, out / name)
manifest = {}
for p in sorted(out.iterdir()):
    if p.is_file():
        manifest[p.name] = hashlib.sha256(p.read_bytes()).hexdigest()
(out / 'SHA256.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(out)
