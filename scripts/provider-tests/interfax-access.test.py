import base64
import importlib.util
import io
import json
from pathlib import Path
import ssl
import sys
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deploy'))
import interfax_access as access
spec = importlib.util.spec_from_file_location('prepare_interfax', ROOT / 'deploy/prepare-interfax.py')
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)

class Reply(io.BytesIO):
    status = 200

class Account(unittest.TestCase):
    def success(self, request, timeout):
        self.assertEqual(request.full_url, access.PROFILE_URL)
        self.assertEqual(request.method, 'GET')
        self.assertIsNone(request.data)
        self.assertEqual(timeout, 15)
        self.assertEqual(request.get_header('Authorization'), 'Basic ' + base64.b64encode(b'api-user:PRIVATE').decode())
        return Reply(b'{"EnablePostponed":true,"EnableLists":false,"EndPointURL":"PRIVATE PROFILE"}')

    def test_readonly_auth_check_returns_no_profile_or_secret(self):
        result = access.check({'INTERFAX_USERNAME':'api-user','INTERFAX_PASSWORD':'PRIVATE'}, self.success)
        self.assertTrue(result['accountVerified'])
        self.assertFalse(result['faxSent'])
        self.assertFalse(result['pilotEnabled'])
        self.assertNotIn('PRIVATE', json.dumps(result))
        self.assertNotIn('api-user', json.dumps(result))

    def test_credentials_missing_or_invalid_do_not_open_network(self):
        def forbidden(*a, **kw): raise AssertionError('network attempted')
        self.assertEqual(access.check({}, forbidden)['missing'], ['INTERFAX_USERNAME','INTERFAX_PASSWORD'])
        for user, password in [('api:user','p'),('user','bad\npassword')]:
            self.assertEqual(access.check({'INTERFAX_USERNAME':user,'INTERFAX_PASSWORD':password}, forbidden)['code'],'FAX_CREDENTIALS_INVALID')

    def test_http_errors_are_specific_and_redacted(self):
        for status, expected in [(401,'FAX_AUTH_REJECTED'),(403,'FAX_ACCESS_DENIED'),(302,'FAX_REDIRECT_REFUSED'),(429,'FAX_RATE_LIMITED'),(503,'FAX_PROVIDER_UNAVAILABLE')]:
            with self.subTest(status=status):
                def fail(*a, **kw): raise urllib.error.HTTPError('https://example.test',status,'PRIVATE',{},io.BytesIO(b'PRIVATE'))
                result = access.check({'INTERFAX_USERNAME':'api-user','INTERFAX_PASSWORD':'PRIVATE'}, fail)
                self.assertEqual(result['code'], expected)
                self.assertNotIn('PRIVATE', json.dumps(result))

    def test_tls_and_timeout_errors_are_not_credential_failures(self):
        for error, expected in [(urllib.error.URLError(ssl.SSLCertVerificationError('PRIVATE')),'FAX_TLS_FAILED'),(TimeoutError('PRIVATE'),'FAX_TIMEOUT'),(urllib.error.URLError('PRIVATE'),'FAX_NETWORK_UNAVAILABLE')]:
            def fail(*a, **kw): raise error
            self.assertEqual(access.check({'INTERFAX_USERNAME':'u','INTERFAX_PASSWORD':'p'}, fail)['code'], expected)

    def test_html_malformed_oversized_or_wrong_schema_cannot_verify_account(self):
        for raw in [b'<html>Login</html>',b'{}',b'{"EnableLists":1,"EnablePostponed":true}',b'null',b'x'*65537]:
            with self.subTest(raw=raw[:30]):
                self.assertEqual(access.check({'INTERFAX_USERNAME':'u','INTERFAX_PASSWORD':'p'},lambda *a,**kw:Reply(raw))['code'],'FAX_INVALID_RESPONSE')

    def test_default_opener_enforces_tls_and_denies_redirects(self):
        def build(*handlers):
            self.assertTrue(any(isinstance(h,access.NoRedirect) for h in handlers))
            https=next(h for h in handlers if isinstance(h,access.urllib.request.HTTPSHandler))
            self.assertTrue(https._context.check_hostname)
            self.assertEqual(https._context.verify_mode,ssl.CERT_REQUIRED)
            return type('Opener',(),{'open':staticmethod(self.success)})()
        with patch.object(access.urllib.request,'build_opener',side_effect=build):
            self.assertTrue(access.verify_account('api-user','PRIVATE'))
        self.assertIsNone(access.NoRedirect().redirect_request(None,None,302,'',{},'https://evil.test'))

    def test_saved_runtime_preserves_equals_in_password_without_shell_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'runtime.env'
            target.write_text('# comment\nINTERFAX_USERNAME=user\nINTERFAX_PASSWORD=a=b$(echo secret)\n')
            self.assertEqual(access.read_runtime(target)['INTERFAX_PASSWORD'],'a=b$(echo secret)')
            link=Path(folder)/'link';link.symlink_to(target)
            with self.assertRaisesRegex(access.AccessError,'FAX_PRIVATE_RUNTIME_MISSING'):access.read_runtime(link)

    def test_pilot_enabled_requires_provider_and_valid_approved_number(self):
        values={'INTERFAX_USERNAME':'api-user','INTERFAX_PASSWORD':'PRIVATE','MIRKAM_FAX_PROVIDER':'interfax','MIRKAM_FAX_TEST_NUMBER':'+97231234567'}
        self.assertTrue(access.check(values,self.success)['pilotEnabled'])
        self.assertFalse(access.check({**values,'MIRKAM_FAX_TEST_NUMBER':'wrong'},self.success)['pilotEnabled'])

    def test_prepare_rejected_credentials_never_modify_existing_private_runtime(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'runtime.env';original=b'EXISTING_KEY=unchanged\n';target.write_bytes(original)
            with patch.object(prepare.os,'geteuid',return_value=0),patch.object(prepare,'Path',return_value=target),patch.object(prepare.getpass,'getpass',side_effect=['api-user','PRIVATE']),patch('builtins.input',return_value='+97231234567'),patch.object(prepare,'verify_account',side_effect=access.AccessError('FAX_AUTH_REJECTED')):
                with self.assertRaisesRegex(SystemExit,'FAX_AUTH_REJECTED'):prepare.main()
            self.assertEqual(target.read_bytes(),original)
            self.assertEqual(len(list(Path(folder).iterdir())),1)

    def test_credentials_only_checks_then_saves_privately_without_enabling_pilot(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'runtime.env';original=b'EXISTING_KEY=unchanged\n';target.write_bytes(original)
            with patch.object(prepare.os,'geteuid',return_value=0),patch.object(prepare,'Path',return_value=target),patch.object(prepare.getpass,'getpass',side_effect=['api-user','PRIVATE']),patch('builtins.input',side_effect=AssertionError('no target requested')),patch.object(prepare,'verify_account',return_value=True) as verify,patch('builtins.print'):
                prepare.main(credentials_only=True)
            verify.assert_called_once_with('api-user','PRIVATE')
            values=access.read_runtime(target)
            self.assertEqual(values['EXISTING_KEY'],'unchanged')
            self.assertEqual(values['INTERFAX_PASSWORD'],'PRIVATE')
            self.assertNotIn('MIRKAM_FAX_PROVIDER',values)
            self.assertNotIn('MIRKAM_FAX_TEST_NUMBER',values)
            self.assertEqual(target.stat().st_mode & 0o777,0o600)
            backup=next(Path(folder).glob('runtime.env.before-fax-*'))
            self.assertEqual(backup.read_bytes(),original)
            self.assertEqual(backup.stat().st_mode & 0o777,0o600)

    def test_subscription_setup_needs_no_test_number_and_preserves_other_keys(self):
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/'runtime.env'
            original=b'EXISTING_KEY=unchanged\nMIRKAM_FAX_MODE=pilot\nMIRKAM_FAX_TEST_NUMBER=+97231234567\n'
            target.write_bytes(original)
            with patch.object(prepare.os,'geteuid',return_value=0),patch.object(prepare,'Path',return_value=target),patch.object(prepare.getpass,'getpass',side_effect=['api-user','PRIVATE']),patch('builtins.input',side_effect=AssertionError('no test number required')),patch.object(prepare,'verify_account',return_value=True),patch('builtins.print'):
                prepare.main()
            values=access.read_runtime(target)
            self.assertEqual(values['MIRKAM_FAX_MODE'],'live')
            self.assertEqual(values['MIRKAM_FAX_PROVIDER'],'interfax')
            self.assertEqual(values['EXISTING_KEY'],'unchanged')
            self.assertEqual(target.stat().st_mode & 0o777,0o600)
            result=access.check(values,self.success)
            self.assertTrue(result['sendingEnabled'])
            self.assertFalse(result['pilotEnabled'])
            self.assertFalse(result['incomingVerified'])
            self.assertEqual(next(Path(folder).glob('runtime.env.before-fax-*')).read_bytes(),original)

    def test_subscription_check_without_target_and_invalid_mode(self):
        values={'INTERFAX_USERNAME':'api-user','INTERFAX_PASSWORD':'PRIVATE','MIRKAM_FAX_PROVIDER':'interfax','MIRKAM_FAX_MODE':'live'}
        self.assertTrue(access.check(values,self.success)['sendingEnabled'])
        self.assertFalse(access.check({**values,'MIRKAM_FAX_MODE':'typo'},self.success)['sendingEnabled'])

if __name__ == '__main__': unittest.main()
