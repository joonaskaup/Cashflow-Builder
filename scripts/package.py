"""Package only reviewed app files, runtime and fictional example."""
from pathlib import Path
import hashlib
import runpy
import stat
import zipfile

ROOT=Path(__file__).resolve().parents[1]
APP=ROOT/'app'
RELEASE=runpy.run_path(str(APP/'version.py'))
VERSION=RELEASE['VERSION']
ZIP_DATE=tuple(int(n) for n in RELEASE['RELEASE_DATE'].split('-'))+(0,0,0)
ALLOWED={'helper','runtime','welcome','Example','local_app.py','offline.sb',
         'Start Cashflow Builder.command','START HERE.md','THIRD PARTY NOTICES.md',
         'update_app.py','Update existing Cashflow Builder.command','help.html','version.py'}

def package():
    runpy.run_path(str(ROOT/'scripts/build_docs.py'),run_name='__main__')
    if not (APP/'runtime/python/bin/python3').is_file():raise ValueError('Supply the relocatable macOS arm64 runtime before packaging.')
    for name in ALLOWED:
        if not (APP/name).exists():raise ValueError('Missing release item: '+name)
    out=ROOT/'dist'/f'Cashflow-Builder-{VERSION}-macos-arm64.zip';out.parent.mkdir(exist_ok=True)
    files=[]
    for p in sorted(APP.rglob('*')):
        rel=p.relative_to(APP)
        if rel.parts[0] not in ALLOWED:continue
        if any(part.startswith('.') or part=='__pycache__' for part in rel.parts):continue
        if p.suffix=='.pyc' or p.name.endswith('.inspect.ndjson'):continue
        if not p.is_file():continue
        if p.is_symlink() and not p.resolve().is_relative_to(APP):raise ValueError('External symlink: '+str(rel))
        if rel.parts[0]=='Example' and str(rel)!='Example/Fictional budget.xlsx':raise ValueError('Unexpected example file: '+str(rel))
        if rel.parts[0]=='helper' and p.suffix not in ('.py','.js','.html','.css'):raise ValueError('Unexpected helper file: '+str(rel))
        if rel.parts[0]=='welcome' and p.suffix not in ('.js','.html','.css'):raise ValueError('Unexpected welcome file: '+str(rel))
        files.append((p,rel))
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for p,rel in files:
            info=zipfile.ZipInfo(str(Path('Cashflow Builder')/rel),ZIP_DATE)
            info.create_system=3;info.external_attr=(stat.S_IFREG | stat.S_IMODE(p.stat().st_mode))<<16
            info.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(info,p.read_bytes())
    checksum=hashlib.sha256(out.read_bytes()).hexdigest()
    (out.parent/(out.name+'.sha256')).write_text(checksum+'  '+out.name+'\n')
    print(f'{out.name}: {out.stat().st_size/1024/1024:.1f} MB; {len(files)} files; no projects or backups')

if __name__=='__main__':package()
