"""Updater recovery uses temporary folders and a local test app only."""
from pathlib import Path
import json,subprocess,sys,tempfile,unittest
from unittest.mock import patch
APP=Path(__file__).resolve().parents[1]/'app'
sys.path.insert(0,str(APP))
import update_app as u

class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.target=Path(self.tmp.name).resolve()/'Installed'
        (self.target/'Projects').mkdir(parents=True)
    def tearDown(self):self.tmp.cleanup()
    def session(self,url):
        (self.target/'Projects/.session.json').write_text(json.dumps({'url':url}))
    def test_only_loopback_session_urls_are_accepted(self):
        good='http://127.0.0.1:12345/#'+'a'*30
        self.session(good);self.assertEqual(u.running_session(self.target),good)
        for url in ['https://example.org/#'+'a'*30,'http://127.0.0.1.evil:12345/#'+'a'*30,
                    'http://user@127.0.0.1:12345/#'+'a'*30,'http://127.0.0.1:12345/api/stop#'+'a'*30,
                    'http://127.0.0.1:12345/?next=evil#'+'a'*30,'http://127.0.0.1:bad/#'+'a'*30]:
            self.session(url);self.assertIsNone(u.running_session(self.target))
        self.assertIsNone(u.NoRedirect().redirect_request(None,None,None,None,None,None))
    def test_cancel_never_stops_or_updates(self):
        with patch.object(u,'update',side_effect=u.AppRunningError('running')),patch.object(u,'prompt_running',return_value='Cancel update'),patch.object(u,'stop_running') as stop:
            self.assertIsNone(u.interactive_update(self.target));stop.assert_not_called()
    def test_open_does_not_stop_and_can_cancel(self):
        with patch.object(u,'update',side_effect=u.AppRunningError('running')),patch.object(u,'prompt_running',side_effect=['Open existing app','Cancel update']),patch.object(u,'open_existing') as opened,patch.object(u,'stop_running') as stop:
            self.assertIsNone(u.interactive_update(self.target));opened.assert_called_once_with(self.target);stop.assert_not_called()
    def test_explicit_saved_choice_required_for_stop(self):
        self.session('http://127.0.0.1:12345/#'+'a'*30)
        with patch.object(u,'update',side_effect=u.AppRunningError('running')),patch.object(u,'prompt_running',return_value='I saved — update'),patch.object(u,'stop_running') as stop,patch.object(u,'wait_and_update',return_value=Path('backup')) as wait:
            self.assertEqual(u.interactive_update(self.target),Path('backup'));stop.assert_called_once_with(self.target);wait.assert_called_once_with(self.target)
    def test_timeout_preserves_lock(self):
        with patch.object(u,'update',side_effect=u.AppRunningError('running')):
            with self.assertRaisesRegex(u.AppRunningError,'still shutting down'):u.wait_and_update(self.target,timeout=0)
    def test_missing_session_does_not_send_stop_request(self):
        with patch.object(u.urllib.request,'build_opener') as opener:
            with self.assertRaisesRegex(ValueError,'Could not locate'):u.stop_running(self.target)
            opener.assert_not_called()
    def test_live_app_shutdown_then_update_preserves_projects(self):
        (self.target/'helper').mkdir();(self.target/'helper/engine.py').write_text('old engine')
        (self.target/'local_app.py').write_text('old app')
        (self.target/'Start Cashflow Local.command').write_text('old launcher')
        marker=self.target/'Projects/preserved-test.bin';marker.write_bytes(b'fictional saved data')
        p=subprocess.Popen([sys.executable,'-I',str(APP/'local_app.py'),'manager',str(self.target/'Projects'),'--no-browser'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            self.assertIn('is running',p.stdout.readline());self.assertTrue(p.stdout.readline().startswith('http://127.0.0.1:'))
            with self.assertRaises(u.AppRunningError):u.update(self.target)
            self.assertEqual((self.target/'local_app.py').read_text(),'old app')
            with patch.object(u,'prompt_running',return_value='I saved — update'):
                backup=u.interactive_update(self.target)
            p.wait(timeout=5);self.assertEqual(p.returncode,0)
            self.assertEqual(marker.read_bytes(),b'fictional saved data')
            self.assertEqual((backup/'local_app.py').read_text(),'old app')
            self.assertEqual((self.target/'local_app.py').read_bytes(),(APP/'local_app.py').read_bytes())
            self.assertTrue((self.target/'Start Cashflow Builder.command').exists())
            self.assertFalse((self.target/'Start Cashflow Local.command').exists())
            self.assertFalse((self.target/'Projects/.session.json').exists())
        finally:
            if p.poll() is None:p.terminate();p.wait(timeout=5)
            p.stdout.close();p.stderr.close()

if __name__=='__main__':unittest.main()
