"""Launch an isolated Zen profile, run verification, then stop only that browser."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument('--binary', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--locale', default='zh-CN')
parser.add_argument('--test-script', choices=['test-zen.py', 'test-zen-naming.py'], default='test-zen.py')
parser.add_argument('--extension', default=str(Path(__file__).resolve().parents[1]))
args = parser.parse_args()
out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
downloads = out / 'Downloads'; downloads.mkdir(exist_ok=True)
with socket.socket() as s:
    s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='pagesaver-zen-profile-') as profile:
    # Give the native host its own Obsidian registry and disposable vault. Never
    # register a test vault in the real Obsidian configuration or write user notes.
    real_home = Path.home()
    test_home = Path(profile) / 'home'; test_home.mkdir()
    vault = out / 'Vault'; vault.mkdir(exist_ok=True)
    app_support = test_home / 'Library/Application Support'
    for browser_name in ['Mozilla', 'Zen']:
        source = real_home / 'Library/Application Support' / browser_name / 'NativeMessagingHosts/app.pagesaver.save.json'
        if source.exists():
            dest = app_support / browser_name / 'NativeMessagingHosts/app.pagesaver.save.json'
            dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(source.read_bytes())
    config = app_support / 'obsidian/obsidian.json'; config.parent.mkdir(parents=True)
    config.write_text(json.dumps({'vaults': {'pagesaver-test-vault': {'path': str(vault)}}}))
    (Path(profile) / 'user.js').write_text('user_pref("browser.download.folderList",2);\nuser_pref("browser.download.dir",'+json.dumps(str(downloads))+');\n'+'user_pref("intl.locale.requested",'+json.dumps(args.locale)+');\n'+'user_pref("marionette.port",%d);\nuser_pref("zen.welcome-screen.seen",true);\nuser_pref("browser.shell.checkDefaultBrowser",false);\n' % port)
    with (out / 'browser.log').open('w') as log:
        browser = subprocess.Popen([args.binary, '-headless', '-no-remote', '-profile', profile, '--marionette'],
                                   env=dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS='1', HOME=str(test_home)), stdout=log, stderr=log)
        try:
            for _ in range(300):
                if browser.poll() is not None:
                    raise RuntimeError('Isolated Zen exited; inspect browser.log')
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=.2):
                        break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError('Isolated Zen did not start')
            subprocess.run([sys.executable, str(Path(__file__).with_name(args.test_script)), '--port', str(port),
                            '--output', str(out), '--extension', args.extension], check=True)
        finally:
            if browser.poll() is None:
                browser.terminate()
                try:
                    browser.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    browser.kill(); browser.wait()
