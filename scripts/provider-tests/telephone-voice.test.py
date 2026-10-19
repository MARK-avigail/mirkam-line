import importlib.util
from pathlib import Path
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('select_voice',Path(__file__).resolve().parents[2]/'deploy/select-telephone-voice.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class VoiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.original='DATA_ENCRYPTION_KEY=keep-key\nOPENAI_API_KEY=keep-api\nMIRKAM_TTS_VOICE=coral\n'
        (self.root/'runtime.env').write_text(self.original)
    def test_selection_preserves_keys_backup_permissions_and_is_repeatable(self):
        self.assertTrue(m.select_voice('marin',self.root));expected=self.original.replace('coral','marin')
        self.assertEqual((self.root/'runtime.env').read_text(),expected)
        self.assertEqual((self.root/'runtime.before-telephone-voice.env').read_text(),self.original)
        self.assertEqual((self.root/'runtime.env').stat().st_mode&0o777,0o600)
        self.assertEqual((self.root/'runtime.before-telephone-voice.env').stat().st_mode&0o777,0o600)
        self.assertFalse(m.select_voice('marin',self.root))
        self.assertTrue(m.select_voice('shimmer',self.root))
        self.assertEqual((self.root/'runtime.before-telephone-voice.env').read_text(),self.original)
    def test_live_voice_id_is_not_a_valid_tts_selection(self):
        with self.assertRaises(ValueError):m.select_voice('voice_example',self.root)
        self.assertEqual((self.root/'runtime.env').read_text(),self.original)
    def test_duplicate_old_settings_are_replaced_by_one_selection(self):
        (self.root/'runtime.env').write_text(self.original+'MIRKAM_TTS_VOICE=shimmer\n')
        m.select_voice('marin',self.root)
        self.assertEqual((self.root/'runtime.env').read_text().count('MIRKAM_TTS_VOICE='),1)
    def test_symlink_is_rejected(self):
        target=self.root/'runtime.env';target.unlink();target.symlink_to(self.root/'outside')
        with self.assertRaises(ValueError):m.select_voice('marin',self.root)
if __name__=='__main__':unittest.main()
