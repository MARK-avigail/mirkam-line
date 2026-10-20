"""Read-only InterFAX account verification; never submit, log or follow redirects."""
import base64
import json
import re
import socket
import ssl
import urllib.error
import urllib.request
from pathlib import Path

PROFILE_URL = 'https://rest.interfax.net/outbound/sendingprofile'
RUNTIME = Path('/opt/mirkam-private/runtime.env')

class AccessError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def read_runtime(target=RUNTIME):
    if target.is_symlink() or not target.is_file():
        raise AccessError('FAX_PRIVATE_RUNTIME_MISSING')
    try:
        result = {}
        for line in target.read_text().splitlines():
            if not line.strip() or line.lstrip().startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            result[key.strip()] = value
        return result
    except Exception:
        raise AccessError('FAX_PRIVATE_RUNTIME_UNREADABLE') from None

def validate_credentials(username, password):
    if not username or not password:
        raise AccessError('FAX_CREDENTIALS_MISSING')
    if ':' in username or any(ord(c) < 32 or ord(c) == 127 for c in username + password):
        raise AccessError('FAX_CREDENTIALS_INVALID')

def verify_account(username, password, opener=None):
    validate_credentials(username, password)
    token = base64.b64encode((username + ':' + password).encode()).decode('ascii')
    request = urllib.request.Request(PROFILE_URL, method='GET', headers={
        'Authorization': 'Basic ' + token, 'Accept': 'application/json'})
    context = ssl.create_default_context()
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    open_request = opener or urllib.request.build_opener(
        NoRedirect(), urllib.request.HTTPSHandler(context=context)).open
    try:
        with open_request(request, timeout=15) as response:
            if response.status != 200:
                raise AccessError('FAX_ACCOUNT_NOT_VERIFIED')
            raw = response.read(65537)
            if len(raw) > 65536:
                raise AccessError('FAX_INVALID_RESPONSE')
            try:
                profile = json.loads(raw)
            except (ValueError, UnicodeError):
                raise AccessError('FAX_INVALID_RESPONSE') from None
            # A 200 HTML login page or arbitrary JSON is not account validation.
            if (not isinstance(profile, dict) or
                type(profile.get('EnablePostponed')) is not bool or
                type(profile.get('EnableLists')) is not bool):
                raise AccessError('FAX_INVALID_RESPONSE')
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        result = ('FAX_AUTH_REJECTED' if code == 401 else
                  'FAX_ACCESS_DENIED' if code == 403 else
                  'FAX_RATE_LIMITED' if code == 429 else
                  'FAX_REDIRECT_REFUSED' if 300 <= code < 400 else
                  'FAX_PROVIDER_UNAVAILABLE')
        raise AccessError(result) from None
    except AccessError:
        raise
    except (ssl.SSLError, urllib.error.URLError, OSError) as error:
        reason = getattr(error, 'reason', error)
        result = ('FAX_TLS_FAILED' if isinstance(reason, ssl.SSLError) else
                  'FAX_TIMEOUT' if isinstance(reason, (TimeoutError, socket.timeout)) else
                  'FAX_NETWORK_UNAVAILABLE')
        raise AccessError(result) from None
    except Exception:
        raise AccessError('FAX_ACCOUNT_CHECK_FAILED') from None
    # Never return provider data: it can contain private account configuration.
    return True

def check(values, opener=None):
    missing = [key for key in ('INTERFAX_USERNAME', 'INTERFAX_PASSWORD') if not values.get(key)]
    result = {'check': 'INTERFAX_ACCESS', 'credentialsPresent': not bool(missing),
              'accountVerified': False, 'faxSent': False, 'missing': missing}
    if missing:
        return {**result, 'code': 'FAX_CREDENTIALS_MISSING'}
    try:
        verify_account(values['INTERFAX_USERNAME'], values['INTERFAX_PASSWORD'], opener)
        number = values.get('MIRKAM_FAX_TEST_NUMBER', '')
        valid_number = bool(re.fullmatch(r'\+[1-9][0-9]{7,14}', number))
        return {**result, 'accountVerified': True, 'testDestinationConfigured': valid_number,
                'pilotEnabled': values.get('MIRKAM_FAX_PROVIDER') == 'interfax' and valid_number,
                'code': 'FAX_ACCOUNT_ACCESS_OK'}
    except AccessError as error:
        return {**result, 'code': str(error)}
