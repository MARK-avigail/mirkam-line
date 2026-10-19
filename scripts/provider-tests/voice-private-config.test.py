import importlib.util,json,os,tempfile,unittest,zipfile
from pathlib import Path
spec=importlib.util.spec_from_file_location('prepare',Path(__file__).resolve().parents[2]/'deploy/prepare-voice-elements.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.private=self.root/'private';self.private.mkdir()
        self.original='DATA_ENCRYPTION_KEY=unchanged-test-key\nOPENAI_API_KEY=unchanged-test-api\n'
        (self.private/'runtime.env').write_text(self.original)
        self.archive=self.root/'demo.zip'
        self.config={'ApplicationSettings':{'VoiceElementsTest':{'PhoneServer':'tcp://example.test:54332','Username':'test-user','Password':'test-password'}}}
        self.writezip(self.config)
    def writezip(self,config):
        with zipfile.ZipFile(self.archive,'w') as z:z.writestr('VoiceApp/appsettings.json',json.dumps(config))
    def test_preserves_keys_private_permissions_and_backup(self):
        folder=m.prepare(self.archive,self.private)
        runtime=(self.private/'runtime.env').read_text()
        self.assertTrue(runtime.startswith(self.original));self.assertEqual((folder/'runtime.before-voice-elements.env').read_text(),self.original)
        for file in ['bridge.env','appsettings.json','runtime.before-voice-elements.env']:self.assertEqual((folder/file).stat().st_mode&0o777,0o600)
        self.assertEqual(folder.stat().st_mode&0o777,0o700)
        self.assertEqual(json.loads((folder/'appsettings.json').read_text()),self.config)
    def test_repeat_preserves_token_and_first_backup(self):
        folder=m.prepare(self.archive,self.private);first=(self.private/'runtime.env').read_text()
        m.prepare(self.archive,self.private)
        self.assertEqual((self.private/'runtime.env').read_text(),first);self.assertEqual(first.count('VOICE_ELEMENTS_BRIDGE_TOKEN='),1)
        self.assertEqual((folder/'runtime.before-voice-elements.env').read_text(),self.original)
    def test_invalid_config_never_modifies_runtime(self):
        self.writezip({'ApplicationSettings':{}})
        with self.assertRaises(ValueError):m.prepare(self.archive,self.private)
        self.assertEqual((self.private/'runtime.env').read_text(),self.original)
    def test_duplicate_token_rejected(self):
        original=self.original+'VOICE_ELEMENTS_BRIDGE_TOKEN='+'x'*64+'\nVOICE_ELEMENTS_BRIDGE_TOKEN='+'y'*64+'\n'
        (self.private/'runtime.env').write_text(original)
        with self.assertRaises(ValueError):m.prepare(self.archive,self.private)
        self.assertEqual((self.private/'runtime.env').read_text(),original)
    def test_archive_traversal_is_not_extracted(self):
        with zipfile.ZipFile(self.archive,'a') as z:z.writestr('../unwanted','not allowed')
        m.prepare(self.archive,self.private);self.assertFalse((self.root/'unwanted').exists())
    def test_symlinked_runtime_rejected(self):
        runtime=self.private/'runtime.env';runtime.unlink();target=self.root/'target';target.write_text(self.original);runtime.symlink_to(target)
        with self.assertRaises(ValueError):m.prepare(self.archive,self.private)
        self.assertEqual(target.read_text(),self.original)
if __name__=='__main__':unittest.main()
