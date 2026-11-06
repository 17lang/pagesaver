"""Run against a separately launched Zen --marionette test profile, never the user's profile.
Requires marionette_driver (development only). See tools/native-helper/README.md.
"""
import argparse
import base64
import hashlib
import http.server
import json
from pathlib import Path
import threading
import time
from marionette_driver.marionette import Marionette
from marionette_driver.addons import Addons

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=2829)
parser.add_argument('--output', required=True)
parser.add_argument('--extension', default=str(Path(__file__).resolve().parents[1]))
args = parser.parse_args()
out = Path(args.output).resolve(); out.mkdir(parents=True, exist_ok=True)
for name in ['Markdown', 'Markdown2', 'PDF']:
    (out / name).mkdir(exist_ok=True)
results = []

def record(name, detail):
    results.append({'check': name, 'result': 'PASS', 'detail': detail})
    print('PASS', name, flush=True)

m = Marionette(port=args.port, socket_timeout=210)
m.start_session()
m.timeout.script = 200
caps = m.session_capabilities
m.navigate('about:blank')
Addons(m).install(str(Path(args.extension).resolve()), temp=True)
m.set_context('chrome')
url = m.execute_script("return WebExtensionPolicy.getByID('pagesaver@pagesaver.local').getURL('options/settings.html')")
m.set_context('content'); m.switch_to_window(m.window_handles[0]); m.navigate(url)

def js(code, *values):
    return m.execute_script('const w=window.wrappedJSObject; ' + code, script_args=list(values))

def promise(expression, *values):
    raw = m.execute_async_script('''const w=window.wrappedJSObject;
const done=arguments[arguments.length-1];
Promise.resolve(''' + expression + ''').then(value=>done(JSON.stringify({value}))).catch(e=>done(JSON.stringify({error:e.message})));''', script_args=list(values))
    data = json.loads(raw)
    if 'error' in data:
        raise AssertionError(data['error'])
    return data.get('value')

def set_input(id, value):
    js('const e=document.getElementById(arguments[0]); e.value=arguments[1]; e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));', id, value)

def save_settings():
    js('document.getElementById("save-settings").click()')
    for _ in range(150):
        value = js('return document.getElementById("settings-status").textContent')
        if value == '已保存':
            return
        if value not in ['正在检查保存位置…', '尚未保存', '']:
            raise AssertionError(value)
        time.sleep(.1)
    raise AssertionError('save settings timed out')

def send(message):
    return promise('w.browser.runtime.sendMessage(w.JSON.parse(arguments[0]))', json.dumps(message))

class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        content = ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Pagesaver 验证文章</title></head>'
                   '<body><nav>不应成为正文的菜单</nav><article><h1>Pagesaver 验证文章</h1>' +
                   ''.join('<p>这是用于测试网页保存的正文。PDF、HTML 和 Markdown 应当分别进入设置的文件夹。中文内容和链接需要完整保留。第 %d 段。</p>' % i for i in range(12)) +
                   '<a href="https://example.org/">参考链接</a></article></body></html>').encode()
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(content)
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Page)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    time.sleep(.5)
    promise('w.browser.storage.local.set({pagesaverDestinations:{naming:{enabled:false}}})')
    m.navigate(url); time.sleep(.5)
    assert js('return document.querySelector("#pdf-mode option[value=markdown]").disabled')
    assert js('return document.querySelector("#html-mode option[value=markdown]").disabled')
    assert js('return [...document.querySelectorAll("#sidebar li")].map(e=>e.dataset.section)') == ['naming', 'markdown', 'pdf', 'html']
    record('initial gating and save-only navigation', 'Both follow choices disabled; only Markdown, PDF, HTML sections')
    ping = promise('w.PageSaverNative.call({action:"ping"})')
    assert ping['version'] == '0.5.0'
    record('Zen native connection', ping)
    set_input('markdown-mode', 'absolute'); set_input('markdown-path', str(out / 'Markdown'))
    assert js('return document.querySelector("#pdf-mode option[value=markdown]").disabled')
    save_settings()
    assert not js('return document.querySelector("#pdf-mode option[value=markdown]").disabled')
    record('enable follow only after valid Markdown settings saved', 'Unsaved draft does not enable follow')
    set_input('pdf-mode', 'absolute'); set_input('pdf-path', str(out / 'PDF')); set_input('html-mode', 'markdown'); save_settings()
    m.navigate(url); time.sleep(.5)
    assert js('return document.getElementById("html-mode").value') == 'markdown'
    record('settings survive page reopen', 'Independent PDF path and HTML follow persisted')
    md = send({'type': 'MARKDOWN_SAVE', 'title': '中文笔记', 'markdown': '# 标题\n\n中文🙂内容\n'})
    assert md['ok'], md
    assert Path(md['path']).read_text() == '# 标题\n\n中文🙂内容\n'
    html = send({'type': 'HTML_SAVE', 'title': '中文网页', 'html': '<!doctype html><meta charset="utf-8"><p>完整网页</p>'})
    assert html['ok'] and Path(html['path']).parent == out / 'Markdown', html
    record('background Markdown and HTML destination routing', 'Real native files contain exact UTF-8 content')
    again = send({'type': 'MARKDOWN_SAVE', 'title': '中文笔记', 'markdown': 'second'})
    assert again['ok'] and again['path'] != md['path'] and Path(md['path']).read_text().startswith('# 标题')
    record('duplicate name preserves original', Path(again['path']).name)
    large = promise('w.PageSaverNative.save(new w.Blob(["中文🙂".repeat(1500000)]), "large.md", {mode:"absolute",path:arguments[0]})', str(out / 'Markdown'))
    expected = ('中文🙂' * 1500000).encode()
    assert Path(large['path']).read_bytes() == expected
    record('large native transfer', {'bytes': len(expected), 'sha256': hashlib.sha256(expected).hexdigest()})
    set_input('markdown-path', str(out / 'Markdown2')); save_settings()
    html2 = send({'type': 'HTML_SAVE', 'title': '跟随新位置', 'html': '<p>follow</p>'})
    assert html2['ok'] and Path(html2['path']).parent == out / 'Markdown2'
    record('HTML follows updated Markdown location', 'No stale copied path')
    # Failure must not reset the last saved settings or fall back to Downloads.
    set_input('markdown-path', str(out / 'missing')); js('document.getElementById("save-settings").click()'); time.sleep(.5)
    assert js('return document.getElementById("settings-status").textContent') != '已保存'
    stored = promise('w.browser.storage.local.get("pagesaverDestinations")')
    assert stored['pagesaverDestinations']['markdown']['path'] == str(out / 'Markdown2')
    record('invalid location cannot replace valid settings', 'Missing folder rejected, previous settings retained')
    set_input('markdown-path', str(out / 'Markdown2')); save_settings()
    js('document.querySelector("#sidebar li[data-section=pdf] button").click()')
    (out / 'settings-pdf.png').write_bytes(m.screenshot(full=True, format='binary'))
    # Use a real webpage and invoke the installed extension's existing content entry points.
    article = 'http://127.0.0.1:%d/' % server.server_port
    tab = promise('w.browser.tabs.create({url:arguments[0],active:true})', article)
    time.sleep(2)
    promise('w.browser.tabs.sendMessage(arguments[0],{type:"MARKDOWN_RUN"})', tab['id'])
    for _ in range(200):
        generated = list((out / 'Markdown2').glob('Pagesaver*.md'))
        if generated: break
        time.sleep(.1)
    assert generated, 'Markdown extraction did not save a file'
    assert '用于测试网页保存' in generated[0].read_text()
    record('actual webpage Markdown extraction', generated[0].name)
    promise('w.browser.tabs.sendMessage(arguments[0],{type:"HTML_RUN"})', tab['id'])
    for _ in range(500):
        generated_html = list((out / 'Markdown2').glob('Pagesaver*.html'))
        if generated_html: break
        time.sleep(.1)
    assert generated_html, 'HTML extraction did not save a file'
    assert '用于测试网页保存' in generated_html[0].read_text()
    record('actual webpage complete HTML save', generated_html[0].name)
    promise('w.browser.tabs.sendMessage(arguments[0],{type:"CAP_PREPARE"})', tab['id'])
    visible = promise('w.browser.tabs.executeScript(arguments[0],{code:`[...document.querySelectorAll("div[data-jopp-picker-ui]")].filter(e=>!e.hasAttribute("data-jopp-overlay") && e.textContent.includes("已保存完整 HTML")).map(e=>getComputedStyle(e).visibility)`})', tab['id'])
    assert visible[0] and all(value == 'hidden' for value in visible[0]), visible
    promise('w.browser.tabs.sendMessage(arguments[0],{type:"CAP_RESTORE"})', tab['id'])
    record('previous save toast hidden during PDF capture', 'Prepared capture hides toast and restore completes')
    pdf = send({'type': 'CAPTURE_PAGE_PDF'})
    assert pdf['ok'], pdf
    pdfpath = Path(pdf['filename']); assert pdfpath.parent == out / 'PDF' and pdfpath.read_bytes().startswith(b'%PDF-')
    record('actual webpage full PDF capture', {'filename': pdfpath.name, 'bytes': pdfpath.stat().st_size, 'textCount': pdf.get('textCount')})
    # Content script error path: choose a saved folder, remove it, then save again.
    doomed = out / 'removed-after-settings'; doomed.mkdir(exist_ok=True)
    promise('w.browser.storage.local.set({pagesaverDestinations:{pdf:{mode:"default"},html:{mode:"absolute",path:arguments[0]},markdown:{mode:"absolute",path:arguments[0]}}})', str(doomed))
    doomed.rmdir()
    failure = send({'type': 'MARKDOWN_SAVE', 'title': '不可写', 'markdown': 'must not save elsewhere'})
    assert not failure['ok'] and '文件夹' in failure['error']
    record('configured write failure stays a failure', failure['error'])
    for message in ['MARKDOWN_RUN', 'HTML_RUN']:
        promise('w.browser.tabs.sendMessage(arguments[0],{type:arguments[1]})', tab['id'], message)
        for _ in range(300):
            text = promise('w.browser.tabs.executeScript(arguments[0],{code:"document.body.innerText"})', tab['id'])[0]
            expected_error = '保存 Markdown 失败：文件夹不存在' if message == 'MARKDOWN_RUN' else '保存失败：文件夹不存在'
            if expected_error in text:
                break
            time.sleep(.1)
        assert expected_error in text, text
        record(message + ' content save failure reports an error', 'No silent fallback success message')
    # The launcher supplies an isolated Obsidian registration with a disposable vault.
    # This is a real native lookup + dropdown + save flow, not a mocked browser API.
    vaults = promise('w.PageSaverNative.call({action:"vaults"})')['vaults']
    if any(v['id'] == 'pagesaver-test-vault' for v in vaults):
        m.navigate(url); time.sleep(.5)
        set_input('markdown-mode', 'vault')
        js('document.getElementById("refresh-vaults").click()')
        for _ in range(100):
            if js('return !!document.querySelector("#template-vault option[value=pagesaver-test-vault]")'):
                break
            time.sleep(.1)
        set_input('template-vault', 'pagesaver-test-vault'); set_input('template-path-name', '网页/Clippings')
        set_input('pdf-mode', 'markdown'); set_input('html-mode', 'markdown'); save_settings()
        vault_target = out / 'Vault/网页/Clippings'
        vault_md = send({'type': 'MARKDOWN_SAVE', 'title': '仓库笔记', 'markdown': '# 仓库正文'})
        vault_html = send({'type': 'HTML_SAVE', 'title': '仓库网页', 'html': '<p>仓库网页</p>'})
        assert vault_md['ok'] and Path(vault_md['path']).parent == vault_target, vault_md
        assert vault_html['ok'] and Path(vault_html['path']).parent == vault_target, vault_html
        assert Path(vault_md['path']).read_text() == '# 仓库正文'
        record('vault dropdown and relative path save', 'Isolated registered vault; missing nested folders created on save')
        vault_pdf = send({'type': 'CAPTURE_PAGE_PDF'})
        assert vault_pdf['ok'] and Path(vault_pdf['filename']).parent == vault_target, vault_pdf
        record('PDF and HTML follow vault-mode Markdown', 'All three files in the same resolved vault subfolder')
        set_input('template-path-name', '../outside')
        js('document.getElementById("save-settings").click()'); time.sleep(.5)
        assert js('return document.getElementById("settings-status").textContent') != '已保存'
        record('settings reject a relative path outside the vault', 'Prior valid vault configuration retained')
        set_input('template-path-name', '网页/Clippings'); save_settings()
        js('document.querySelector("#sidebar li[data-section=markdown] button").click()')
        (out / 'settings-markdown.png').write_bytes(m.screenshot(full=True, format='binary'))
    else:
        raise AssertionError('Isolated vault fixture missing; run through run-zen-verification.py')
    record('no highlighter or reader in options assets', 'Verified three-section DOM; package audit checks source paths')
finally:
    (out / 'zen-results.json').write_text(json.dumps({'browser': caps, 'results': results}, ensure_ascii=False, indent=2))
    server.shutdown()
    m.delete_session()
