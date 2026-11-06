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

# Two origins reproduce a full-window cross-origin document without network reliance.
class Page(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/frame':
            html = '<style>html,body{margin:0}section{height:600px}</style><title>Frame fixture</title>' + ''.join('<section style="background:'+c+'">Band '+str(i)+'</section>' for i,c in enumerate(['#ff0000','#00ff00','#0000ff','#ffff00']))
        else:
            html = '<title>Frame wrapper</title><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}</style><iframe src="http://127.0.0.1:'+str(frame_server.server_port)+'/frame"></iframe>'
        self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(html.encode())
    def log_message(self,*args): pass
frame_server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Page)
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Page)
for s in [server,frame_server]: threading.Thread(target=s.serve_forever,daemon=True).start()
try:
    destinations={kind:{'mode':'absolute','path':str(out.resolve())} for kind in ['pdf','html','markdown']}
    destinations['naming']={'enabled':False,'datePosition':'before'}
    promise('w.browser.storage.local.set({pagesaverDestinations:w.JSON.parse(arguments[0])})',json.dumps(destinations))
    tab=promise('w.browser.tabs.create({url:arguments[0],active:true})','http://127.0.0.1:'+str(server.server_port))
    time.sleep(1)
    promise('w.browser.tabs.executeScript(arguments[0],{allFrames:true,code:arguments[1]})',tab['id'],"if(location.pathname==='/frame')scrollTo(0,150)")
    result=promise('w.browser.runtime.sendMessage({type:"CAPTURE_PAGE_PDF"})')
    result.pop('preview',None)
    assert result['ok'] and result['height']==2400 and result['screens']>2,result
    record('Cross-origin full-window frame: captures all 2400px across multiple screens')
    states=promise('w.browser.tabs.executeScript(arguments[0],{allFrames:true,code:arguments[1]})',tab['id'],"({path:location.pathname,y:scrollY,style:document.documentElement.style.getPropertyValue('scroll-behavior')})")
    frame=[s for s in states if s['path']=='/frame'][0]
    assert frame['y']==150 and frame['style']=='',states
    record('Frame reading position and scroll behavior restored after capture')
    (out/'results.json').write_text(json.dumps({'checks':results,'capture':result,'restored':states},indent=2))
finally:
    for s in [server,frame_server]:s.shutdown()
    m.delete_session()
