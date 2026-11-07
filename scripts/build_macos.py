"""Build a locally signed, self-contained .app. This does NOT notarize it."""
from pathlib import Path
import hashlib
import importlib.metadata as metadata
import json
import os
import plistlib
import runpy
import shutil
import subprocess
import struct
import sys

ROOT=Path(__file__).resolve().parents[1]
APP=ROOT/'app'
RELEASE=runpy.run_path(str(APP/'version.py'))
BUILD=ROOT/'build/macos'
DIST=ROOT/'dist/macos'

def run(*args,**kwargs):
    subprocess.run([str(a) for a in args],check=True,**kwargs)

def main():
    if sys.platform!='darwin':raise SystemExit('Build on an Apple silicon Mac.')
    BUILD.mkdir(parents=True,exist_ok=True);DIST.mkdir(parents=True,exist_ok=True)
    runpy.run_path(str(ROOT/'scripts/build_docs.py'),run_name='__main__')
    data=[]
    for directory in ('helper','welcome'):
        for p in sorted((APP/directory).iterdir()):
            if p.suffix in ('.js','.css','.html'):data.append((str(p),directory))
    for name in ('help.html','offline.sb'):
        data.append((str(APP/name),'.'))
    data.append((str(APP/'Example/Fictional budget.xlsx'),'Example'))
    licenses=BUILD/'Third-party licenses';licenses.mkdir(exist_ok=True)
    dependencies=['openpyxl','et_xmlfile','lxml','pyinstaller']
    notice=['Cashflow Builder Mac app bundle',f'Python {sys.version.split()[0]}','',
            'This build is locally (ad-hoc) signed. It is not Apple-notarized.',
            'Included dependency licenses are in this folder.','']
    for name in dependencies:
        package=metadata.distribution(name)
        notice.append(f'{name} {package.version}')
        for item in package.files or []:
            if any('licen' in part.lower() or part.lower()=='copying' for part in item.parts):
                source=Path(package.locate_file(item))
                if source.is_file():
                    dest=licenses/name/Path(*item.parts[1:]);dest.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copy2(source,dest)
    python_license=Path(sys.base_prefix)/'lib/python3.12/LICENSE.txt'
    if not python_license.is_file():raise ValueError('Python license not found')
    shutil.copy2(python_license,licenses/'Python-LICENSE.txt')
    (licenses/'NOTICES.txt').write_text('\n'.join(notice)+'\n')
    data.append((str(licenses),'Third-party licenses'))
    spec=BUILD/'Cashflow.spec'
    spec.write_text(f'''a = Analysis([{str(APP/'bundle_entry.py')!r}], pathex=[{str(APP)!r}],
    binaries=[], datas={data!r}, hiddenimports=[], hookspath=[],
    excludes=['tkinter', 'unittest', 'pydoc', 'test'])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='CashflowEngine',
    console=True, target_arch='arm64', codesign_identity=None)
coll = COLLECT(exe, a.binaries, a.datas, name='CashflowEngine')
app = BUNDLE(coll, name='Cashflow Builder.app',
    bundle_identifier='io.github.joonaskaup.cashflowbuilder',
    version={RELEASE['VERSION']!r}, info_plist={{'LSMinimumSystemVersion':'12.0'}})
''')
    env=dict(os.environ,PYINSTALLER_CONFIG_DIR=str(BUILD/'cache'),PYINSTALLER_STRICT_BUNDLE_CODESIGN_ERROR='1')
    run(sys.executable,'-m','PyInstaller','--noconfirm','--clean','--distpath',DIST,'--workpath',BUILD/'work',spec,env=env)
    bundle=DIST/'Cashflow Builder.app'
    native=bundle/'Contents/MacOS/CashflowBuilder'
    sdk_args=['-sdk',os.environ['SDKROOT']] if os.environ.get('SDKROOT') else []
    run('/usr/bin/xcrun','swiftc','-O','-target','arm64-apple-macos12.0',*sdk_args,
        '-module-cache-path',BUILD/'swift-cache',ROOT/'macos/Launcher.swift','-o',native)
    run('/usr/bin/xcrun','swiftc','-O','-target','arm64-apple-macos12.0',*sdk_args,
        '-module-cache-path',BUILD/'swift-cache',ROOT/'macos/Icon.swift','-o',BUILD/'make-icon')
    run(BUILD/'make-icon',BUILD/'AppIcon.iconset')
    icon_chunks=[]
    for kind,name in [('ic07','icon_128x128.png'),('ic08','icon_256x256.png'),
                      ('ic09','icon_512x512.png'),('ic10','icon_512x512@2x.png')]:
        png=(BUILD/'AppIcon.iconset'/name).read_bytes()
        icon_chunks.append(kind.encode()+struct.pack('>I',len(png)+8)+png)
    payload=b''.join(icon_chunks)
    (bundle/'Contents/Resources/AppIcon.icns').write_bytes(b'icns'+struct.pack('>I',len(payload)+8)+payload)
    info_path=bundle/'Contents/Info.plist'
    info=plistlib.loads(info_path.read_bytes())
    info.update(CFBundleExecutable='CashflowBuilder',CFBundleName='Cashflow Builder',
                CFBundleDisplayName='Cashflow Builder',CFBundleShortVersionString=RELEASE['VERSION'].split('rc')[0],
                CFBundleVersion='0.2.0',CashflowVersion=RELEASE['VERSION'],CFBundleIconFile='AppIcon.icns',NSHighResolutionCapable=True)
    info_path.write_bytes(plistlib.dumps(info))
    run('/usr/bin/codesign','--force','--sign','-','--timestamp=none',bundle/'Contents/MacOS/CashflowEngine')
    run('/usr/bin/codesign','--force','--sign','-','--timestamp=none',native)
    run('/usr/bin/codesign','--force','--sign','-','--timestamp=none',bundle)
    run('/usr/bin/codesign','--verify','--deep','--strict','--verbose=2',bundle)
    archive=ROOT/'dist'/f"Cashflow-Builder-{RELEASE['VERSION']}-macos-arm64-app.zip"
    if archive.exists():archive.unlink()
    run('/usr/bin/ditto','-c','-k','--keepParent','--norsrc',bundle,archive)
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    Path(str(archive)+'.sha256').write_text(digest+'  '+archive.name+'\n')
    print(json.dumps({'app':str(bundle),'zip':str(archive),'sha256':digest,'notarized':False}))

if __name__=='__main__':main()
