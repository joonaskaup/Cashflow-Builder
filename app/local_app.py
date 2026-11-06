"""Local-only launcher, project chooser and authenticated project server."""
from __future__ import annotations
import argparse
import base64
import copy
import datetime as dt
import fcntl
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

APP=Path(__file__).resolve().parent
sys.path.insert(0,str(APP))
from version import DISPLAY_VERSION
os.umask(0o077)
# This guard covers Python sockets even when local_app.py is run directly.
# The normal launcher also applies the macOS outbound-network sandbox.
def network_guard(event,args):
    if event=='socket.connect':
        address=args[1]
        if isinstance(address,tuple) and address[0] not in ('127.0.0.1','::1','localhost'):
            raise PermissionError('Cashflow Builder cannot connect to external networks')
    if event=='socket.getaddrinfo' and args[0] not in ('127.0.0.1','::1','localhost',None):
        raise PermissionError('Cashflow Builder cannot look up external hosts')
    if event=='socket.bind':
        address=args[1]
        if isinstance(address,tuple) and address[0]!='127.0.0.1':
            raise PermissionError('Cashflow Builder listens only on this computer')
sys.addaudithook(network_guard)

from helper import engine,workbooks
from helper.server import Project
from helper.local_writer import write_list
import openpyxl

MAPPING={'sheet':'Erittely','label':'B','amount':'H','section':'A','description':'C','total':'I',
         'duration':'D','durationUnit':'E','grandLabel':'KOKONAISKUSTANNUKSET YHTEENSÄ',
         'adminLabel':'HALLINTOKULUT korkeintaan 5%','reserveLabel':'VARAUS SATUNNAISIIN KULUIHIN 7-10%',
         'phaseColumns':[],'allowanceCategorySource':'Primary labels'}
MAX_FILE=25*1024*1024

def read_json(path):return json.loads(Path(path).read_text())
def write_json(path,value):
    path=Path(path);tmp=path.with_suffix('.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False));tmp.replace(path)

def configure(root):
    root=Path(root).resolve()
    engine.ROOT=workbooks.ROOT=root
    engine.LIST=workbooks.LIST=root/'outputs/erittely-extraction/Erittely_cost_list.xlsx'

def validate_archive(data):
    if len(data)>MAX_FILE:raise ValueError('Choose a workbook smaller than 25 MB')
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names=z.namelist()
            if len(names)>12000 or sum(x.file_size for x in z.infolist())>250*1024*1024:
                raise ValueError('The workbook is too large to unpack safely')
            if 'xl/workbook.xml' not in names:raise ValueError('Choose an Excel .xlsx or .xlsm workbook')
            if any(n.startswith('/') or '..' in Path(n).parts for n in names):raise ValueError('Invalid workbook archive paths')
    except zipfile.BadZipFile:raise ValueError('Save the workbook as .xlsx or .xlsm in Excel first') from None

def inspect_upload(data):
    validate_archive(data)
    w=openpyxl.load_workbook(io.BytesIO(data),read_only=True,data_only=True)
    try:
        cash='Maksuvalmiussuunnitelma'
        first=''
        if cash in w.sheetnames:
            for row in w[cash].iter_rows(min_row=7,max_row=7,min_col=5,max_col=6):
                for c in row:
                    if isinstance(c.value,(dt.date,dt.datetime)):
                        first=c.value.strftime('%Y-%m');break
        from helper.allowances import label_kind,description_kind
        conflicts=[]
        if MAPPING['sheet'] in w.sheetnames:
            for row in w[MAPPING['sheet']].iter_rows():
                if len(row)<9:continue
                primary=label_kind(row[1].value,MAPPING);translated=description_kind(row[2].value)
                if primary and translated and primary!=translated and row[8].value is not None:
                    conflicts.append({'row':row[1].row,'label':str(row[1].value),'description':str(row[2].value)})
        return {'allowanceConflicts':conflicts,'sheets':w.sheetnames,'firstMonth':first,'cashflowSheet':cash,'mapping':MAPPING}
    finally:w.close()

def validate_layout(path,name):
    w=openpyxl.load_workbook(path,read_only=True,data_only=True)
    try:
        if name not in w.sheetnames:raise ValueError(f'The original cashflow worksheet "{name}" is missing')
        s=w[name]
        labels={20:'kustannukset',21:'käsikirjoitus',22:'elokuvahenkilökunta',23:'esiintyjät',
                38:'sekalaiset',39:'hallintokulut',40:'varaus',41:'kokonaiskustannukset',42:'loppukassa'}
        for r,needle in labels.items():
            text=' '.join(str(s.cell(r,c).value or '').casefold() for c in range(1,4))
            if needle not in text:
                raise ValueError(f'This cashflow layout is not supported yet (row {r}). This version expects the original FFF layout: costs in rows 21–40, total 41, balance 42. Your original file has not been changed.')
    finally:w.close()

def initialize(root,config):
    configure(root);validate_layout(config['budget'],config['cashflowSheet'])
    imported=engine.extract_budget(config)
    dates=[{'id':i,'name':name,'kind':'period','start':'','end':'','weights':{},'precision':'month'}
           for i,name in [('hist','Historical'),('pre','Preparation'),('shoot','Shooting'),('post','Postproduction')]]
    dates[0]['label']=''
    # Preserve an existing historical label, but never infer new work dates.
    w=openpyxl.load_workbook(config['budget'],read_only=True,data_only=True)
    label=w[config['cashflowSheet']]['E7'].value;w.close()
    if isinstance(label,str) and re.fullmatch(r'\d{2}/\d{2}[-–]\d{2}/\d{2}',label):dates[0]['label']=label
    state={'version':1,'config':config,'dates':dates,'rules':{},
           'costs':engine.match_costs([],imported['groups'],initial=True),'source':imported,
           'revision':0,'example':False,'updated':dt.datetime.now(dt.timezone.utc).isoformat()}
    engine.LIST.parent.mkdir(parents=True,exist_ok=True)
    (engine.ROOT/'work').mkdir(exist_ok=True)
    model=engine.evaluate(state);write_list(state,model,engine.LIST)
    return {'costs':len(state['costs']),'total':model['total']}

class LocalHandler(BaseHTTPRequestHandler):
    token=''
    def respond(self,status,value,kind='application/json'):
        data=json.dumps(value,ensure_ascii=False).encode() if kind=='application/json' else value
        self.send_response(status)
        for key,val in {
            'Content-Type':kind,'Content-Length':str(len(data)),'Cache-Control':'no-store',
            'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
            'X-Frame-Options':'DENY',
            'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        }.items():self.send_header(key,val)
        self.end_headers();self.wfile.write(data)
    def valid(self,auth=True):
        expected=f'127.0.0.1:{self.server.server_port}'
        if self.headers.get('Host')!=expected:return False
        if self.headers.get('Origin') not in (None,'http://'+expected):return False
        if auth and not secrets.compare_digest(self.headers.get('X-Cashflow-Token',''),self.token):return False
        return True
    def body(self,limit=2_000_000):
        n=int(self.headers.get('Content-Length','0'))
        if not 0<n<=limit:raise ValueError('Request is empty or too large')
        def invalid(v):raise ValueError('Enter a finite number')
        return json.loads(self.rfile.read(n),parse_constant=invalid)
    def static(self,root,allowed):
        if not self.valid(False):self.respond(403,{'error':'Local requests only'});return True
        name='index.html' if self.path=='/' else self.path[1:]
        if name not in allowed:return False
        ext=Path(name).suffix
        kind={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}[ext]
        data=(root/name).read_bytes()
        if ext=='.html':data=data.replace(b'__APP_VERSION__',DISPLAY_VERSION.encode())
        self.respond(200,data,kind);return True
    def log_message(self,*args):pass

def project_server(root,token,parent_url):
    project_lock=(Path(root)/'.project.lock').open('a')
    fcntl.flock(project_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    configure(root);manifest=read_json(Path(root)/'project.json')
    budget=Path(root)/'Budget'/manifest['budgetFile']
    original_read=workbooks.read_state
    def relocated():
        s=original_read()
        if not s:raise ValueError('The extracted list has no saved project information')
        s['config']['budget']=str(budget);s['source']['path']=str(budget)
        return s
    workbooks.read_state=relocated
    class LocalProject(Project):
        def commit(self,candidate,render=False,allow_splits=False):
            if workbooks.read_state()['revision']!=self.state['revision']:
                raise ValueError('This project changed on disk. Reopen it before saving; your pending edits are retained.')
            return super().commit(candidate,render,allow_splits=allow_splits)
    project=LocalProject()
    # One process owns a project. The manager reuses it when Open is clicked again.
    class Handler(LocalHandler):
        def do_GET(self):
            if self.static(APP,{'help.html'}):return
            if self.static(APP/'helper',{'index.html','app.js','planner.js','actions.js','timing.js','day-split.js','plan-state.js','session.js','schedule.js','schedule-ui.js','installments.js','timeline-edit.js','display-range.js','source-details.js','schedule.css','agreement-report.js','agreement-report.css'}):return
            if not self.valid():return self.respond(403,{'error':'Open this project from Cashflow Builder to continue'})
            if self.path=='/api/state':
                with project.lock:return self.respond(200,{**project.view(),'localHome':parent_url,'localProject':manifest['name']})
            if self.path.split('?')[0] in ('/api/agreement-report','/api/agreement-report.xlsx'):
                from helper import agreement_report
                from urllib.parse import urlsplit, parse_qs
                try:
                    with project.lock:
                        query=parse_qs(urlsplit(self.path).query)
                        if 'revision' in query and query['revision'][0]!=str(project.state['revision']):
                            raise ValueError('The saved plan changed. Close and reopen the report before downloading.')
                        report=agreement_report.build(project.state,manifest['name'],project.model)
                    if self.path.split('?')[0].endswith('.xlsx'):
                        return self.respond(200,agreement_report.spreadsheet(report),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                    return self.respond(200,report)
                except (ValueError,KeyError,TypeError) as e:return self.respond(422,{'error':str(e)})
            self.respond(404,{'error':'Not found'})
        def do_POST(self):
            if not self.valid():return self.respond(403,{'error':'Local session expired. Open the project again.'})
            try:
                body=self.body();action=self.path.removeprefix('/api/')
                if action=='preview':
                    with project.lock:result=project.preview(body)
                elif action=='actions':
                    from helper import reusable_actions
                    with project.lock:result=reusable_actions.save_library(body)
                elif action=='open':
                    file=engine.LIST if body.get('file')=='list' else budget
                    subprocess.run(['/usr/bin/open',str(file)],check=True)
                    result={'opened':file.name}
                elif action=='settings' and Path(body.get('config',{}).get('budget','')).resolve()!=budget.resolve():
                    raise ValueError('This project uses its own working copy. Create a new project to use another budget.')
                else:result=project.request(action,body)
                self.respond(200,result)
            except (ValueError,KeyError,TypeError,ArithmeticError) as e:self.respond(422,{'error':str(e)})
            except Exception as e:self.respond(500,{'error':'Could not save. Your previous files are retained. '+str(e)})
    Handler.token=token
    http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    print(json.dumps({'port':http.server_port}),flush=True)
    http.serve_forever()

class Manager:
    def __init__(self,root,token):
        self.root=Path(root).resolve();self.root.mkdir(parents=True,exist_ok=True,mode=0o700)
        self.token=token;self.pending={};self.children={};self.lock=threading.RLock();self.url=''
    def projects(self):
        result=[]
        for p in sorted(self.root.glob('*/project.json')):
            try:
                m=read_json(p)
                if re.fullmatch('[a-f0-9]{32}',p.parent.name):result.append({'id':p.parent.name,'name':m['name'],'created':m['created']})
            except (ValueError,OSError,KeyError):pass
        return result
    def stage(self,body):
        if body.get('demo'):
            name='Fictional budget.xlsx';data=(APP/'Example'/name).read_bytes()
        else:
            name=Path(body.get('filename','')).name
            if Path(name).suffix.lower() not in ('.xlsx','.xlsm'):raise ValueError('Choose an .xlsx or .xlsm file. Convert old .xls files in Excel first.')
            try:data=base64.b64decode(body['data'],validate=True)
            except (KeyError,ValueError):raise ValueError('Choose the workbook again') from None
        result=inspect_upload(data);ident=uuid.uuid4().hex
        # Only the latest upload is retained, in memory, until project creation.
        self.pending={ident:{'name':name,'data':data,'demo':bool(body.get('demo'))}}
        return {**result,'upload':ident,'filename':name,'demo':bool(body.get('demo'))}
    def create(self,body):
        item=self.pending.get(body.get('upload'))
        if not item:raise ValueError('Choose the workbook again; the upload has expired')
        name=str(body.get('name','')).strip()
        if not name or len(name)>100:raise ValueError('Enter a project name (up to 100 characters)')
        first=body.get('firstMonth','').strip()
        local_month=re.fullmatch(r'(0?[1-9]|1[0-2])/(\d{4}|\d{2})',first)
        if local_month:
            mm,yy=local_month.groups();first=f'{int(yy)+(2000 if len(yy)==2 else 0):04d}-{int(mm):02d}'
        if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])',first):raise ValueError('Choose the first cashflow month')
        mapping={**MAPPING,**body.get('mapping',{})}
        # Project import has no exclusion shortcut: every source cost must reconcile.
        ident=uuid.uuid4().hex;root=self.root/ident
        try:
            (root/'Original').mkdir(parents=True)
            (root/'Budget').mkdir()
            original=root/'Original'/item['name'];original.write_bytes(item['data'])
            budget=root/'Budget'/item['name'];budget.write_bytes(item['data'])
            config={'budget':str(budget),'cashflowSheet':body.get('cashflowSheet','Maksuvalmiussuunnitelma'),
                    'firstMonth':first+'-01','excludedSections':'','mapping':mapping}
            # Extraction globals stay confined to their own short-lived process.
            run=subprocess.run([sys.executable,'-I',str(APP/'local_app.py'),'initialize',str(root)],
                               input=json.dumps(config),text=True,capture_output=True,timeout=90)
            result=json.loads(run.stdout)
            if run.returncode or 'error' in result:raise ValueError(result.get('error','Could not import workbook'))
            manifest={'name':name,'budgetFile':item['name'],'created':dt.datetime.now(dt.timezone.utc).isoformat(),
                      'demo':item['demo']}
            write_json(root/'project.json',manifest)
            self.pending.clear()
            return {**result,'id':ident,'name':name}
        except Exception:
            shutil.rmtree(root,ignore_errors=True)
            raise
    def open(self,ident):
        if not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident):raise ValueError('Choose an existing project')
        root=self.root/ident
        if not (root/'project.json').exists():raise ValueError('Project not found')
        current=self.children.get(ident)
        if current and current['process'].poll() is None:return {'url':current['url']}
        token=secrets.token_urlsafe(32)
        p=subprocess.Popen([sys.executable,'-I',str(APP/'local_app.py'),'project',str(root)],
                           stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
        p.stdin.write(json.dumps({'token':token,'home':self.url})+'\n');p.stdin.close()
        import selectors
        with selectors.DefaultSelector() as selector:
            selector.register(p.stdout,selectors.EVENT_READ)
            if not selector.select(60):
                p.terminate();raise ValueError('Opening took too long. Close Excel and try again.')
            info=p.stdout.readline()
        try:port=json.loads(info)['port']
        except (ValueError,KeyError):
            p.wait(timeout=5);raise ValueError('Could not open this project. Check that its Budget and outputs folders are intact.') from None
        url=f'http://127.0.0.1:{port}/#'+token
        self.children[ident]={'process':p,'url':url}
        return {'url':url}
    def close(self):
        for x in self.children.values():
            if x['process'].poll() is None:x['process'].terminate()
        for x in self.children.values():
            try:x['process'].wait(timeout=5)
            except subprocess.TimeoutExpired:x['process'].kill()
            finally:
                if x['process'].stdout:x['process'].stdout.close()
        self.pending.clear()

def manage(root,no_browser=False,port=0):
    root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True,mode=0o700)
    manager_lock=(root/'.manager.lock').open('a')
    try:fcntl.flock(manager_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:
        try:
            running=read_json(root/'.session.json')['url']
            if not no_browser:subprocess.Popen(['/usr/bin/open',running],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            print('Cashflow Builder is already running. '+running,flush=True)
        except (OSError,ValueError,KeyError):print('Cashflow Builder is already starting. Use its existing window.',flush=True)
        return
    token=secrets.token_urlsafe(32);manager=Manager(root,token)
    class Handler(LocalHandler):
        def do_GET(self):
            if self.static(APP,{'help.html'}):return
            if self.static(APP/'welcome',{'index.html','welcome.js','style.css'}):return
            if not self.valid():return self.respond(403,{'error':'Use the Start Cashflow Builder launcher to open this page'})
            if self.path=='/api/projects':
                return self.respond(200,{'projects':manager.projects(),'folder':str(manager.root)})
            self.respond(404,{'error':'Not found'})
        def do_POST(self):
            if not self.valid():return self.respond(403,{'error':'Local session expired. Use the launcher again.'})
            try:
                body=self.body(36*1024*1024)
                with manager.lock:
                    if self.path=='/api/stage':result=manager.stage(body)
                    elif self.path=='/api/create':result=manager.create(body)
                    elif self.path=='/api/open':result=manager.open(body.get('id'))
                    elif self.path=='/api/stop':
                        result={'stopped':True}
                        threading.Thread(target=self.server.shutdown,daemon=True).start()
                    else:raise ValueError('Unknown action')
                self.respond(200,result)
            except (ValueError,KeyError,TypeError) as e:self.respond(422,{'error':str(e)})
            except Exception:self.respond(500,{'error':'The operation could not finish. Your original workbook is unchanged.'})
    Handler.token=token
    http=ThreadingHTTPServer(('127.0.0.1',port),Handler)
    manager.url=f'http://127.0.0.1:{http.server_port}/#'+token
    write_json(root/'.session.json',{'url':manager.url})
    print('Cashflow Builder is running. Close this window to stop it.',flush=True)
    print(manager.url,flush=True)
    if not no_browser:subprocess.Popen(['/usr/bin/open',manager.url],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:http.serve_forever()
    except KeyboardInterrupt:pass
    finally:
        manager.close();http.server_close()
        (root/'.session.json').unlink(missing_ok=True)
        manager_lock.close()

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('mode',nargs='?',default='manager',choices=['manager','project','initialize'])
    parser.add_argument('root',nargs='?',default=str(APP/'Projects'))
    parser.add_argument('--no-browser',action='store_true');parser.add_argument('--port',type=int,default=0)
    args=parser.parse_args()
    if args.mode=='initialize':
        try:print(json.dumps(initialize(Path(args.root),json.load(sys.stdin))))
        except Exception as e:print(json.dumps({'error':str(e)}));sys.exit(1)
    elif args.mode=='project':
        session=json.loads(sys.stdin.readline());project_server(Path(args.root),session['token'],session['home'])
    else:manage(args.root,args.no_browser,args.port)

if __name__=='__main__':main()
