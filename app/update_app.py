"""User-run code-only update. Never reads or copies project workbooks."""
from pathlib import Path
import datetime as dt
import fcntl
import json
import re
import time
import urllib.request
from urllib.parse import urlsplit
import shutil
import subprocess
import tempfile

APP=Path(__file__).resolve().parent
ITEMS=['helper','welcome','local_app.py','offline.sb','START HERE.md','THIRD PARTY NOTICES.md','help.html','version.py',
       'Start Cashflow Builder.command','update_app.py','Update existing Cashflow Builder.command']

class AppRunningError(ValueError):
    pass


def update(target,source=APP):
    target=Path(target).resolve();source=Path(source).resolve()
    if target==source:raise ValueError('Choose your existing app folder, not the new download.')
    if not (target/'local_app.py').is_file() or not (target/'helper/engine.py').is_file():
        raise ValueError('Choose your existing app folder containing local_app.py and helper (Cashflow Builder or Cashflow Local).')
    # Lock only: never inspect names, budgets, dates or timing data in Projects.
    projects=target/'Projects';projects.mkdir(exist_ok=True)
    lock=(projects/'.manager.lock').open('a')
    try:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise AppRunningError('Save your work and stop the existing app before updating. Closing the browser alone does not stop it.') from None
        backup=target/'App backups'/dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        backup.mkdir(parents=True)
        done=[]
        with tempfile.TemporaryDirectory(prefix='.update-',dir=target) as td:
            staged=Path(td)
            for name in ITEMS:
                p=source/name
                if not p.exists():raise ValueError('The update package is incomplete: '+name)
                if p.is_dir():shutil.copytree(p,staged/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
                else:shutil.copy2(p,staged/name)
            try:
                for name in ['Start Cashflow Local.command','Update existing Cashflow Local.command']:
                    old=target/name
                    if old.exists():
                        old.rename(backup/name)
                        done.append(name)
                for name in ITEMS:
                    old=target/name
                    if old.exists():old.rename(backup/name)
                    done.append(name)
                    (staged/name).rename(old)
            except Exception:
                for name in reversed(done):
                    current=target/name
                    if current.is_dir():shutil.rmtree(current)
                    elif current.exists():current.unlink()
                    if (backup/name).exists():(backup/name).rename(current)
                raise
        return backup
    finally:lock.close()

def running_session(target):
    """Read only local launch metadata, never budgets or project records."""
    try:
        raw=json.loads((Path(target)/'Projects/.session.json').read_text())['url']
        u=urlsplit(raw)
        if (u.scheme!='http' or u.hostname!='127.0.0.1' or not u.port or u.username or u.password
            or u.path!='/' or u.query or not re.fullmatch(r'[A-Za-z0-9_-]{20,128}',u.fragment)):
            return None
        return raw
    except (OSError,ValueError,KeyError,TypeError):return None


def open_existing(target):
    url=running_session(target)
    if url:
        subprocess.run(['/usr/bin/open',url],check=True)
        return
    for name in ('Start Cashflow Builder.command','Start Cashflow Local.command'):
        if (Path(target)/name).is_file():
            subprocess.run(['/usr/bin/open',str(Path(target)/name)],check=True)
            return
    raise ValueError('Use the existing app’s Projects page to save and stop it, then choose Retry.')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


def stop_running(target):
    """Called only after the user chooses ‘I saved — update’ in this updater."""
    raw=running_session(target)
    if not raw:raise ValueError('Could not locate the running app. Use Projects → Stop app, then Retry.')
    u=urlsplit(raw)
    request=urllib.request.Request('http://127.0.0.1:'+str(u.port)+'/api/stop',data=b'{}',
        headers={'X-Cashflow-Token':u.fragment,'Content-Type':'application/json'})
    # Ignore proxy settings: the session key must remain on loopback, even if redirected.
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    try:
        with opener.open(request,timeout=5) as response:result=json.load(response)
        if result.get('stopped') is not True:raise ValueError('Stop was not confirmed')
    except Exception:
        raise ValueError('Could not confirm that the app stopped. Use Projects → Stop app or close its Terminal window after saving, then Retry. No update was applied.') from None


def wait_and_update(target,timeout=15):
    deadline=time.monotonic()+timeout
    while True:
        try:return update(target)
        except AppRunningError:
            if time.monotonic()>=deadline:
                raise AppRunningError('The app is still shutting down or another copy is running. Save and stop all copies using this folder, then Retry.') from None
            time.sleep(.2)


def prompt_running(can_stop,message=''):
    action='I saved — update' if can_stop else 'Retry'
    script='''on run argv
set reply to display dialog (item 1 of argv) with title "Update Cashflow Builder" buttons {"Cancel update", "Open existing app", item 2 of argv} default button "Open existing app"
return button returned of reply
end run'''
    message=(message+'\n\n' if message else '')+(
        'Cashflow is still running. Closing a browser tab does not stop it.\n\n'
        '1. Open the existing app and save changes in all project tabs.\n'
        '2. Return here and choose “I saved — update”. The updater will stop the app and continue.\n\n'
        'Unsaved edits cannot be saved by the updater.' if can_stop else
        'Save changes in all project tabs, then use Projects → Stop app (or close the app’s Terminal window). Return here and choose Retry.')
    result=subprocess.run(['/usr/bin/osascript','-e',script,message,action],capture_output=True,text=True)
    return result.stdout.strip() if result.returncode==0 else 'Cancel update'


def interactive_update(target):
    message=''
    while True:
        try:return update(target)
        except AppRunningError:
            choice=prompt_running(bool(running_session(target)),message)
            if choice=='Cancel update':return None
            if choice=='Open existing app':
                try:open_existing(target);message='Save your work in the browser, then return to this updater.'
                except (ValueError,subprocess.SubprocessError):message='Open the existing app manually, save, and stop it before retrying.'
            elif choice=='I saved — update':
                try:
                    stop_running(target)
                    return wait_and_update(target)
                except (ValueError,urllib.error.URLError) as error:message=str(error)
            elif choice=='Retry':message=''
            else:return None


if __name__=='__main__':
    try:
        chosen=subprocess.run(['/usr/bin/osascript','-e',
            'POSIX path of (choose folder with prompt "Choose your EXISTING Cashflow Builder or Cashflow Local folder. Your Projects will stay in place.")'],
            capture_output=True,text=True)
        backup=interactive_update(chosen.stdout.strip()) if chosen.returncode==0 else None
        if backup is None:print('Update cancelled. No application files changed.')
        else:
            print('Updated the app. Your Projects folder and its budgets, dates and payment choices were not changed.')
            print('Previous application code is backed up in: '+str(backup))
            print('Open Start Cashflow Builder.command from your existing folder.')
    except Exception as e:print('Update not completed: '+str(e))
    input('Press Return to close.')
