"""Exercise the actual frozen distribution with temporary fictional projects.

This is functional acceptance, NOT a browser-download/Gatekeeper approval test.
"""
import hashlib
import json
import os
from pathlib import Path
import plistlib
import runpy
import selectors
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
VERSION=runpy.run_path(str(ROOT/'app/version.py'))['VERSION']
ARCHIVE=ROOT/'dist'/f'Cashflow-Builder-{VERSION}-macos-arm64-app.zip'

def request(url,token,path,body=None):
    req=urllib.request.Request(url+'api/'+path,
        None if body is None else json.dumps(body).encode(),
        {'X-Cashflow-Token':token,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=45) as response:return json.load(response)
    except urllib.error.HTTPError as error:
        raise AssertionError(error.read().decode()) from error

def start(bundle,projects):
    command=['/usr/bin/sandbox-exec','-f',str(bundle/'Contents/Resources/offline.sb'),
             str(bundle/'Contents/MacOS/CashflowEngine'),'manager',str(projects),'--no-browser']
    process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout,selectors.EVENT_READ)
            assert selector.select(30),'Engine did not become ready'
        first=process.stdout.readline()
        assert 'is running' in first,first+process.stderr.read()
        url,token=process.stdout.readline().strip().split('#')
        return process,url,token
    except Exception:
        process.terminate();process.wait(timeout=10);raise

def stop(process,url,token):
    if process.poll() is None:request(url,token,'stop',{})
    process.wait(timeout=15)
    assert process.returncode==0,process.stderr.read()
    process.stdout.close();process.stderr.close()

with tempfile.TemporaryDirectory(prefix='cashflow-mac-accept-') as td:
    root=Path(td).resolve()
    subprocess.run(['/usr/bin/ditto','-x','-k',str(ARCHIVE),str(root)],check=True)
    bundle=root/'Cashflow Builder.app'
    subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(bundle)],check=True)
    info=plistlib.loads((bundle/'Contents/Info.plist').read_bytes())
    assert info['CFBundleExecutable']=='CashflowBuilder'
    assert info['CashflowVersion']==VERSION
    assert (bundle/'Contents/Resources/AppIcon.icns').is_file()
    assert os.access(bundle/'Contents/MacOS/CashflowBuilder',os.X_OK)
    assert not list(bundle.rglob('Projects'))
    assert not list(bundle.rglob('*.command'))
    assert not list(bundle.rglob('python3'))
    for link in bundle.rglob('*'):
        if link.is_symlink():assert link.resolve().is_relative_to(bundle),str(link)
    projects=root/'Separate project storage/Projects'
    process,url,token=start(bundle,projects)
    try:
        listing=request(url,token,'projects')
        assert listing['bundled'] and not listing['projects']
        stage=request(url,token,'stage',{'demo':True})
        created=request(url,token,'create',{'upload':stage['upload'],'name':'Fictional bundle test','firstMonth':stage['firstMonth']})
        assert created['total']==3080000
        project_root=projects/created['id']
        original=next((project_root/'Original').glob('*.xlsx')).read_bytes()
        opened=request(url,token,'open',{'id':created['id']})
        purl,ptoken=opened['url'].split('#')
        state=request(purl,ptoken,'state')
        dates=state['state']['dates']
        next(d for d in dates if d['id']=='shoot').update(start='2027-09-01',end='2027-10-31')
        saved=request(purl,ptoken,'dates',{'revision':state['state']['revision'],'dates':dates})
        cost=saved['state']['costs'][0]
        line={'kind':'balance','value':0,'ref':'shoot','basis':'calendar-days','months':0,'days':0}
        saved=request(purl,ptoken,'rules',{'revision':saved['state']['revision'],
            'arrangements':[{'name':'Fictional period','costs':[cost['id']],'lines':[line]}]})
        payments=[p for p in saved['model']['payments'] if p['cost']==cost['id']]
        assert sum(p['amount'] for p in payments)==cost['amount']
        report=request(purl,ptoken,'agreement-report')
        assert report['payments']
        proposal=request(purl,ptoken,'refresh-preview',{'revision':saved['state']['revision']})
        refreshed=request(purl,ptoken,'refresh',{'revision':saved['state']['revision'],'refreshToken':proposal['token']})
        assert refreshed['model']['payments']==saved['model']['payments']
        assert next((project_root/'Original').glob('*.xlsx')).read_bytes()==original
        with urllib.request.urlopen(purl+'help.html') as response:assert b'If the budget changes' in response.read()
    finally:stop(process,url,token)
    assert not (projects/'.session.json').exists()
    # A moved application and copied project storage must reopen the saved plan.
    relocated=root/'Applications/Cashflow Builder.app';relocated.parent.mkdir()
    shutil.move(bundle,relocated)
    moved_projects=root/'Moved Projects';shutil.copytree(projects,moved_projects)
    process,url,token=start(relocated,moved_projects)
    try:
        assert len(request(url,token,'projects')['projects'])==1
        opened=request(url,token,'open',{'id':created['id']})
        purl,ptoken=opened['url'].split('#')
        reopened=request(purl,ptoken,'state')
        assert reopened['model']['payments']==saved['model']['payments']
        assert reopened['files']['budget'].startswith(str(moved_projects))
        process.terminate();process.wait(timeout=15)
        assert process.returncode==0
        assert not (moved_projects/'.session.json').exists()
    finally:
        if process.poll() is None:stop(process,url,token)
        else:process.stdout.close();process.stderr.close()
    subprocess.run(['/usr/bin/codesign','--verify','--deep','--strict',str(relocated)],check=True)
    print('PASS: signed bundle integrity, isolated import/save/refresh/report, relocation, preserved timing, clean shutdown. Gatekeeper first-open is a separate manual test.')
