"""Naming regression against an isolated browser profile supplied by the launcher."""
import argparse
import http.server
import json
from pathlib import Path
import threading
import time
from marionette_driver.marionette import Marionette
from marionette_driver.addons import Addons

parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--extension', required=True)
args = parser.parse_args()
out = Path(args.output); out.mkdir(parents=True, exist_ok=True)
results = []
m = Marionette(port=args.port, socket_timeout=180)
m.start_session(); m.timeout.script = 150
Addons(m).install(str(Path(args.extension).resolve()), temp=True)
m.set_context('chrome')
url = m.execute_script("return WebExtensionPolicy.getByID('pagesaver@pagesaver.local').getURL('options/settings.html#naming')")
m.set_context('content'); m.navigate(url)

def js(code, *values):
    return m.execute_script('const w=window.wrappedJSObject; ' + code, script_args=list(values))

def promise(code, *values):
    raw = m.execute_async_script('const w=window.wrappedJSObject,done=arguments[arguments.length-1];Promise.resolve(' + code + ').then(value=>done(JSON.stringify({value}))).catch(e=>done(JSON.stringify({error:e.message})));', script_args=list(values))
    result = json.loads(raw)
    assert 'error' not in result, result
    return result.get('value')

def record(name):
    results.append(name); print('PASS', name, flush=True)

def save():
    js('document.getElementById("save-settings").click()')
    for _ in range(100):
        if js('return document.getElementById("settings-status").textContent') in ['已保存', 'Saved']:
            return
        time.sleep(.1)
    raise AssertionError('Settings not saved')

def send(message):
    return promise('w.browser.runtime.sendMessage(w.JSON.parse(arguments[0]))', json.dumps(message))

class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        content = ('<!doctype html><meta charset="utf-8"><meta property="article:published_time" content="2026/3/5">'
                   '<title>draw.io：中文 76%！</title><article><h1>draw.io：中文 76%！</h1>' +
                   '<p>这是一篇用于检验文章保存及规范文件名称的测试文章。内容需要完整保留。</p>' * 15 + '</article>').encode()
        self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(content)
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Page)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    time.sleep(.5)
    assert js('return document.getElementById("normalize-filenames").checked')
    assert js('return document.getElementById("filename-date-position").value') == 'before'
    record('Default enabled and date-first; naming settings visible')
    js('document.getElementById("normalize-filenames").click()')
    assert js('return document.getElementById("naming-date-options").hidden')
    save(); m.navigate(url); time.sleep(.3)
    assert not js('return document.getElementById("normalize-filenames").checked')
    record('Off hides date choices and survives reopening')
    title = 'draw.io：中文 76%！'
    # The background naming rule also applies when the save request comes from a content script.
    old = send({'type': 'MARKDOWN_SAVE', 'title': title, 'markdown': '# old'})
    assert old['ok'] and old['filename'] == title + '.md', old
    record('Disabled setting preserves legacy filename behavior')
    for position in ['before', 'after']:
        js('document.getElementById("normalize-filenames").checked=true;document.getElementById("filename-date-position").value=arguments[0];document.getElementById("filename-date-position").dispatchEvent(new Event("change",{bubbles:true}));', position)
        save(); m.navigate(url); time.sleep(.2)
        assert js('return document.getElementById("filename-date-position").value') == position
        expected = '2026-03-05-draw.io-中文-76' if position == 'before' else 'draw.io-中文-76-2026-03-05'
        for kind, field, body, extension in [('MARKDOWN_SAVE', 'markdown', '# normalized', 'md'), ('HTML_SAVE', 'html', '<p>normalized</p>', 'html')]:
            result = send({'type': kind, 'title': title, field: body, 'publishedDate': '2026/3/5'})
            assert result['ok'] and result['filename'] == expected + '.' + extension, result
        record(position + ': settings persist and HTML/Markdown save use normalized names')
    # Switch to real native writes for actual engines and atomic duplicate handling.
    destinations = {kind: {'mode': 'absolute', 'path': str(out.resolve())} for kind in ['markdown', 'pdf', 'html']}
    destinations['naming'] = {'enabled': True, 'datePosition': 'before'}
    promise('w.browser.storage.local.set({pagesaverDestinations:w.JSON.parse(arguments[0])})', json.dumps(destinations))
    tab = promise('w.browser.tabs.create({url:arguments[0],active:true})', 'http://127.0.0.1:' + str(server.server_port))
    time.sleep(1)
    for message, extension in [('MARKDOWN_RUN_START', 'md'), ('HTML_SAVE_START', 'html')]:
        result = send({'type': message}); assert result['ok'], result
        target = out / ('2026-03-05-draw.io-中文-76.' + extension)
        for _ in range(250):
            if target.exists(): break
            time.sleep(.1)
        assert target.exists(), (message, list(out.iterdir()))
    pdf = send({'type': 'CAPTURE_PAGE_PDF'})
    assert pdf['ok'] and Path(pdf['filename']).name == '2026-03-05-draw.io-中文-76.pdf', pdf
    assert Path(pdf['filename']).read_bytes().startswith(b'%PDF')
    record('Actual article Markdown/HTML/PDF all use the page publication date and full normalized title')
    # Use the settings page to issue two identical saves after the article has been captured.
    m.navigate(url); time.sleep(.3)
    existing = (out / '2026-03-05-draw.io-中文-76.md').read_bytes()
    first = send({'type': 'MARKDOWN_SAVE', 'title': title, 'markdown': '# one', 'publishedDate': '2026-03-05'})
    second = send({'type': 'MARKDOWN_SAVE', 'title': title, 'markdown': '# two', 'publishedDate': '2026-03-05'})
    assert first['ok'] and second['ok'] and first['path'] != second['path']
    assert (out / '2026-03-05-draw.io-中文-76.md').read_bytes() == existing
    record('Normalized-name collisions preserve original files and create distinct new files')
    (out / 'naming-results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
    (out / 'naming-settings.png').write_bytes(m.screenshot(format='binary'))
finally:
    server.shutdown()
    m.delete_session()
