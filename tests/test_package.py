"""Unzip as Finder does, run the copied runtime, and exercise its launch/API."""
import json
from pathlib import Path
import os
import runpy
import subprocess
import tempfile
import urllib.request

base=Path(__file__).resolve().parents[1]
release=runpy.run_path(str(base/'app/version.py'))
with tempfile.TemporaryDirectory(prefix='cashflow-package-') as td:
    target=Path(td)
    subprocess.run(['/usr/bin/ditto','-x','-k',str(base/'dist'/f"Cashflow-Builder-{release['VERSION']}-macos-arm64.zip"),td],check=True)
    app=target/'Cashflow Builder';python=app/'runtime/python/bin/python3'
    assert os.access(app/'Start Cashflow Builder.command',os.X_OK)
    assert not (app/'Projects').exists()
    prefix=subprocess.check_output([str(python),'-I','-c','import sys,openpyxl,lxml.etree;print(sys.prefix);print(openpyxl.__file__)'],text=True)
    assert str(app/'runtime/python') in prefix
    assert '.cache/codex' not in prefix
    cmd=['/usr/bin/sandbox-exec','-f',str(app/'offline.sb'),str(python),'-I',str(app/'local_app.py'),'--no-browser']
    p=subprocess.Popen(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        assert 'is running' in p.stdout.readline()
        url=p.stdout.readline().strip();origin,token=url.split('#')
        def api(name,body=None):
            req=urllib.request.Request(origin+'api/'+name,None if body is None else json.dumps(body).encode(),
                {'X-Cashflow-Token':token,'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)
        assert not api('projects')['projects']
        with urllib.request.urlopen(origin+'help.html') as r:
            help_page=r.read().decode()
            assert 'If the budget changes' in help_page and 'Days: budget quantity' in help_page
            assert '<script' not in help_page and 'what-follows-a-date-change' in help_page
        second=subprocess.run(cmd,capture_output=True,text=True,timeout=5)
        assert second.returncode==0 and 'already running' in second.stdout,second.stderr
        stage=api('stage',{'demo':True})
        created=api('create',{'upload':stage['upload'],'name':'Package test','firstMonth':stage['firstMonth']})
        assert created['total']==3080000
        opened=api('open',{'id':created['id']})
        project_origin,project_token=opened['url'].split('#')
        req=urllib.request.Request(project_origin+'api/state',headers={'X-Cashflow-Token':project_token})
        with urllib.request.urlopen(req) as r:state=json.load(r)
        assert state['model']['total']==3080000
        assert 'source-details-v2' in state['capabilities']
        assert 'producer-fees-only' in state['capabilities']
        assert 'salary-note-payments' in state['capabilities']
        with urllib.request.urlopen(project_origin+'timeline-edit.js') as r:
            assert 'function bindTimeline' in r.read().decode()
        with urllib.request.urlopen(project_origin+'display-range.js') as r:
            assert 'function openCashflowRange' in r.read().decode()
        with urllib.request.urlopen(project_origin) as r:
            assert release['DISPLAY_VERSION'] in r.read().decode()
        with urllib.request.urlopen(project_origin+'help.html') as r:
            assert r.read().decode()==help_page
        req=urllib.request.Request(project_origin+'api/agreement-report',headers={'X-Cashflow-Token':project_token})
        with urllib.request.urlopen(req) as r:agreement=json.load(r)
        assert len(agreement['summary'])==9 and agreement['unallocated']==3080000
        assert not agreement['work'] and not agreement['payments']
        req=urllib.request.Request(project_origin+'api/agreement-report.xlsx?revision='+str(agreement['revision']),headers={'X-Cashflow-Token':project_token})
        with urllib.request.urlopen(req) as r:
            assert 'spreadsheetml' in r.headers['Content-Type']
            assert r.read(2)==b'PK'
        try:
            urllib.request.urlopen(project_origin+'api/agreement-report')
            raise AssertionError('Report must require authentication')
        except urllib.error.HTTPError as error:assert error.code==403
        def project_api(action,body):
            req=urllib.request.Request(project_origin+'api/'+action,json.dumps(body).encode(),
                {'X-Cashflow-Token':project_token,'Content-Type':'application/json'})
            with urllib.request.urlopen(req) as r:return json.load(r)
        change={'revision':state['state']['revision'],'firstMonth':'02/2027'}
        report=project_api('range-preview',change)
        assert report['months'][0]=='2027-02'
        changed=project_api('range',change)
        assert changed['model']['months'][0]=='2027-02'
        req=urllib.request.Request(project_origin+'api/agreement-report.xlsx?revision='+str(agreement['revision']),headers={'X-Cashflow-Token':project_token})
        try:
            urllib.request.urlopen(req)
            raise AssertionError('Stale report revision must be rejected')
        except urllib.error.HTTPError as error:assert error.code==422
        assert changed['state']['source']['finance']['I9']==1000000
        with urllib.request.urlopen(project_origin+'app.js') as r:
            assert 'function sourceDetailHTML' in r.read().decode()
        proposal=project_api('refresh-preview',{'revision':changed['state']['revision']})
        refreshed=project_api('refresh',{'revision':changed['state']['revision'],'refreshToken':proposal['token']})
        assert refreshed['state']['costs'][0]['sourceDetails'][0]['rate']==1500
        assert str(app/'Projects') in state['files']['budget']
        api('stop',{})
        p.wait(timeout=10)
        assert p.returncode==0,p.stderr.read()
        assert not (app/'Projects/.session.json').exists()
        print('Packaged build passed: executable launcher, independent relocated runtime, offline startup, single instance, fictional import, project open and clean shutdown.')
    finally:
        if p.poll() is None:p.terminate();p.wait(timeout=5)
        p.stdout.close();p.stderr.close()
