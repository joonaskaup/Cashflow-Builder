from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'app'))
import local_app

class BundlePaths(unittest.TestCase):
    def test_frozen_project_storage_is_outside_application(self):
        with patch.object(sys,'frozen',True,create=True), patch.object(Path,'home',return_value=Path('/tmp/fictional-home')):
            self.assertEqual(local_app.default_projects(),Path('/tmp/fictional-home/Library/Application Support/Cashflow Builder/Projects'))
            self.assertEqual(local_app.process_command('initialize',Path('/tmp/project')),[sys.executable,'initialize','/tmp/project'])

    def test_folder_version_remains_compatible(self):
        with patch.object(sys,'frozen',False,create=True):
            self.assertEqual(local_app.default_projects(),local_app.APP/'Projects')
            self.assertEqual(local_app.process_command('project',Path('/tmp/project')),
                             [sys.executable,'-I',str(local_app.APP/'local_app.py'),'project','/tmp/project'])
