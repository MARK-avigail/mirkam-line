import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
spec=importlib.util.spec_from_file_location('live_project',Path(__file__).resolve().parents[2]/'deploy/prepare-live-project.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PROJECT='proj_testproject1234'
class Response(io.BytesIO):
    status=200
class ProjectTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.original='OPENAI_API_KEY=private-test-key\nDATA_ENCRYPTION_KEY=keep-key\nMIRKAM_TTS_VOICE=keep-voice\n'
        (self.root/'runtime.env').write_text(self.original)
    def good(self,req,timeout):
        self.assertEqual(req.full_url,m.MODEL_URL);self.assertEqual(req.method,'GET')
        self.assertEqual(req.get_header('Openai-project'),PROJECT);self.assertEqual(timeout,15)
        self.assertEqual(req.get_header('Authorization'),'Bearer private-test-key')
        return Response(json.dumps({'id':'gpt-live-1'}).encode())
    def test_validates_model_then_preserves_private_settings_and_backup(self):
        self.assertTrue(m.prepare(PROJECT,self.root,self.good))
        self.assertEqual((self.root/'runtime.env').read_text(),self.original+'MIRKAM_LIVE_PROJECT_ID='+PROJECT+'\n')
        backup=list(self.root.glob('runtime.env.before-live-project-*'))[0]
        self.assertEqual(backup.read_text(),self.original)
        self.assertEqual(backup.stat().st_mode&0o777,0o600)
        self.assertEqual((self.root/'runtime.env').stat().st_mode&0o777,0o600)
        self.assertFalse(m.prepare(PROJECT,self.root,self.good))
        self.assertEqual(len(list(self.root.glob('runtime.env.before-live-project-*'))),1)
    def test_denied_project_never_changes_configuration_or_logs_provider_body(self):
        def denied(req,timeout):raise urllib.error.HTTPError(req.full_url,403,'SECRET-BODY',{},io.BytesIO(b'private-test-key'))
        with self.assertRaisesRegex(m.ConfigurationError,'HTTP_403') as raised:m.prepare(PROJECT,self.root,denied)
        self.assertNotIn('SECRET',str(raised.exception));self.assertNotIn('private-test-key',str(raised.exception))
        self.assertEqual((self.root/'runtime.env').read_text(),self.original)
        self.assertEqual(list(self.root.glob('runtime.env.before-live-project-*')),[])
    def test_invalid_project_does_not_make_a_request(self):
        def unexpected(*args,**kwargs):self.fail('network requested')
        with self.assertRaises(m.ConfigurationError):m.prepare('voice_not_project',self.root,unexpected)
        self.assertEqual((self.root/'runtime.env').read_text(),self.original)
    def test_wrong_or_oversized_response_does_not_write(self):
        for raw in [b'{"id":"another-model"}',b'not json',b'x'*65537]:
            with self.subTest(raw_size=len(raw)):
                with self.assertRaises(m.ConfigurationError):m.prepare(PROJECT,self.root,lambda *a,**k:Response(raw))
                self.assertEqual((self.root/'runtime.env').read_text(),self.original)
    def test_redirects_are_not_followed(self):
        self.assertIsNone(m.NoRedirect().redirect_request(None,None,302,'',{},'https://other.example/'))
    def test_symlink_runtime_rejected(self):
        target=self.root/'runtime.env';target.unlink();target.symlink_to(self.root/'outside')
        with self.assertRaises(m.ConfigurationError):m.prepare(PROJECT,self.root,self.good)
if __name__=='__main__':unittest.main()
