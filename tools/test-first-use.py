"""Fresh-profile test with native host lookup isolated from the current user."""
import socket,tempfile,subprocess,os,time,json,threading,http.server,argparse
from pathlib import Path
from marionette_driver.marionette import Marionette
from marionette_driver.addons import Addons
parser=argparse.ArgumentParser()
parser.add_argument('--binary',required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--extension',default=str(Path(__file__).resolve().parents[1]))
args=parser.parse_args()
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
class Page(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  b=b'<!doctype html><title>First use</title><article><h1>First use</h1><p>Save a webpage without a native helper.</p></article>'
  self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b)
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Page);threading.Thread(target=server.serve_forever,daemon=True).start()
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='pagesaver-first-use-') as temp:
 profile=Path(temp);home=profile/'home';home.mkdir();downloads=out/'Downloads';downloads.mkdir(exist_ok=True)
 (profile/'user.js').write_text('user_pref("marionette.port",%d);\nuser_pref("intl.locale.requested","en-US");\nuser_pref("zen.welcome-screen.seen",true);\nuser_pref("browser.download.folderList",2);\nuser_pref("browser.download.dir",%s);\n'%(port,json.dumps(str(downloads))))
 with (out/'browser.log').open('w') as log:
  p=subprocess.Popen([args.binary,'-headless','-no-remote','-profile',str(profile),'--marionette'],env=dict(os.environ,HOME=str(home),MOZ_REMOTE_ALLOW_SYSTEM_ACCESS='1'),stdout=log,stderr=log)
  m=None;results=[]
  try:
   m=Marionette(port=port,startup_timeout=30);m.start_session();m.timeout.script=90
   Addons(m).install(str(Path(args.extension).resolve()),temp=True)
   m.set_context('chrome')
   m.execute_script('const f=Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);f.initWithPath(arguments[0]);for(const key of ["XREUserNativeManifests","XRESysNativeManifests"])Services.dirsvc.set(key,f);',script_args=[str(home)])
   url=m.execute_script("return WebExtensionPolicy.getByID('pagesaver@pagesaver.local').getURL('options/settings.html')")
   m.set_context('content');m.navigate(url);time.sleep(.5)
   def js(s,*args):return m.execute_script('const w=window.wrappedJSObject;'+s,script_args=list(args))
   def prom(s,*args):
    raw=m.execute_async_script('const w=window.wrappedJSObject,done=arguments[arguments.length-1];Promise.resolve('+s+').then(v=>done(JSON.stringify({value:v}))).catch(e=>done(JSON.stringify({error:e.message})));',script_args=list(args));return json.loads(raw)
   assert js('return document.getElementById("helper-info").hidden')
   assert js('return document.getElementById("vault-status").textContent')==''
   assert 'error' in prom('w.PageSaverNative.call({action:"ping"})')
   results.append('Fresh profile: helper unavailable, default UI has no helper error or installation demand')
   js('const e=document.getElementById("markdown-mode");e.value="obsidian";e.dispatchEvent(new Event("change",{bubbles:true}));document.getElementById("obsidian-vault-name").value="Test vault";document.getElementById("save-settings").click()')
   time.sleep(.5);assert js('return document.getElementById("settings-status").textContent')=='Saved'
   assert not js('return document.querySelector("#pdf-mode option[value=markdown]").disabled')
   assert js('return document.getElementById("helper-info").hidden')
   results.append('Direct Obsidian settings save without helper; named saved vault enables following choice')
   m.navigate(url);time.sleep(.3);assert js('return document.getElementById("obsidian-vault-name").value')=='Test vault'
   prom('w.browser.storage.local.remove("pagesaverDestinations")')
   for typ,field,body in [('MARKDOWN_SAVE','markdown','# No helper\n\nContent'),('HTML_SAVE','html','<!doctype html><p>No helper</p>')]:
    r=prom('w.browser.runtime.sendMessage(w.JSON.parse(arguments[0]))',json.dumps({'type':typ,'title':'No helper',field:body}))
    assert r['value']['ok'],r
   for _ in range(60):
    if len(list(downloads.glob('*')))==2:break
    time.sleep(.1)
   assert any(p.suffix=='.md' and p.read_text()=='# No helper\n\nContent' for p in downloads.iterdir())
   assert any(p.suffix=='.html' for p in downloads.iterdir())
   results.append('Markdown and HTML downloaded to browser folder without helper')
   tab=prom('w.browser.tabs.create({url:arguments[0],active:true})','http://127.0.0.1:'+str(server.server_port))['value'];time.sleep(1)
   r=prom('w.browser.runtime.sendMessage({type:"CAPTURE_PAGE_PDF"})');assert r['value']['ok'],r
   for _ in range(100):
    if list(downloads.glob('*.pdf')):break
    time.sleep(.1)
   assert list(downloads.glob('*.pdf'))[0].read_bytes().startswith(b'%PDF')
   results.append('Actual webpage captured and PDF downloaded without helper')
   (out/'results.json').write_text(json.dumps(results,indent=2));print('\n'.join('PASS '+r for r in results))
  finally:
   if m and m.session:
    try:m.delete_session()
    except:pass
   p.terminate()
   try:p.wait(timeout=10)
   except subprocess.TimeoutExpired:p.kill();p.wait()
server.shutdown()
