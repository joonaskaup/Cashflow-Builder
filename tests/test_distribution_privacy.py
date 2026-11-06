"""Guard the distribution boundary without inspecting any user project."""
import io
from pathlib import Path
import re
import runpy
import sys
import unittest
import zipfile

BASE = Path(__file__).resolve().parents[1]
VERSION = runpy.run_path(str(BASE / 'app/version.py'))['VERSION']
PACKAGE = BASE / 'dist' / f'Cashflow-Builder-{VERSION}-macos-arm64.zip'
sys.path.insert(0, str(BASE / 'app'))
from helper import engine


class DistributionPrivacyTests(unittest.TestCase):
    def test_missing_project_never_loads_a_development_budget(self):
        with self.assertRaisesRegex(ValueError, 'Create a project from the Projects page'):
            engine.initial_state()
        self.assertFalse(hasattr(engine, 'DEFAULT_BUDGET'))

    def test_package_contains_only_release_files(self):
        allowed = {'helper', 'runtime', 'welcome', 'Example', 'local_app.py',
                   'offline.sb', 'Start Cashflow Builder.command', 'START HERE.md',
                   'THIRD PARTY NOTICES.md', 'update_app.py',
                   'Update existing Cashflow Builder.command', 'help.html', 'version.py'}
        with zipfile.ZipFile(PACKAGE) as archive:
            for name in archive.namelist():
                parts = Path(name).parts
                self.assertEqual(parts[0], 'Cashflow Builder')
                self.assertIn(parts[1], allowed, name)
                self.assertFalse(any(p.startswith('.') or p == '__pycache__' for p in parts), name)
                self.assertFalse(name.endswith('.pyc'), name)
                if parts[1] == 'Example':
                    self.assertEqual(parts[2:], ('Fictional budget.xlsx',))

    def test_first_party_files_have_no_personal_home_paths(self):
        pattern = rb'(?:/Users/|/home/|[A-Za-z]:\\Users\\)[^/\\\s<>"\x00]+'
        with zipfile.ZipFile(PACKAGE) as archive:
            for name in archive.namelist():
                parts = Path(name).parts
                if parts[1] == 'runtime':
                    # Third-party binaries/licenses retain their upstream attribution.
                    continue
                data = archive.read(name)
                if name.endswith('.xlsx'):
                    with zipfile.ZipFile(io.BytesIO(data)) as workbook:
                        for member in workbook.namelist():
                            self.assertIsNone(re.search(pattern, workbook.read(member)), member)
                else:
                    self.assertIsNone(re.search(pattern, data), name)


if __name__ == '__main__':
    unittest.main()
