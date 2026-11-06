"""Run the release checks on macOS using only fictional test projects."""
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
node=shutil.which('node')
if not node:raise SystemExit('Node.js is needed for development tests, but not by end users.')
subprocess.run([sys.executable,'-I','-m','unittest','discover','-s',str(ROOT/'tests'),'-p','test_*.py'],cwd=ROOT,check=True)
subprocess.run([node,'--test',*[str(p) for p in sorted((ROOT/'tests').glob('test_*.cjs'))]],cwd=ROOT,check=True)
print('Release checks passed.')
