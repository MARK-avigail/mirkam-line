#!/usr/bin/env python3
"""Check project/model access, then save project selection. No speech or call API."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request

MODEL_URL = 'https://api.openai.com/v1/models/gpt-live-1'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class ConfigurationError(Exception):
    pass

def check_project(project, key, opener=None):
    if not re.fullmatch(r'proj_[A-Za-z0-9_-]{8,100}', project):
        raise ConfigurationError('INVALID_PROJECT_ID: no settings changed')
    if not key or any(c in key for c in '\r\n\x00'):
        raise ConfigurationError('SERVER_API_KEY_MISSING: no settings changed')
    request = urllib.request.Request(MODEL_URL, method='GET', headers={
        'Authorization': 'Bearer ' + key, 'OpenAI-Project': project, 'Accept': 'application/json'})
    opener = opener or urllib.request.build_opener(NoRedirect()).open
    try:
        with opener(request, timeout=15) as response:
            if response.status != 200:
                raise ConfigurationError('MODEL_ACCESS_NOT_CONFIRMED: no settings changed')
            raw = response.read(65537)
            if len(raw) > 65536:
                raise ConfigurationError('INVALID_MODEL_RESPONSE: no settings changed')
            data = json.loads(raw)
            if not isinstance(data, dict) or data.get('id') != 'gpt-live-1':
                raise ConfigurationError('MODEL_ACCESS_NOT_CONFIRMED: no settings changed')
    except urllib.error.HTTPError as error:
        code = error.code
        error.close()
        raise ConfigurationError('PROJECT_MODEL_HTTP_' + str(code) + ': no settings changed') from None
    except ConfigurationError:
        raise
    except Exception:
        # Do not print provider bodies, credential values, headers or exception text.
        raise ConfigurationError('PROJECT_CHECK_UNAVAILABLE: no settings changed') from None

def prepare(project, private=Path('/opt/mirkam-private'), opener=None):
    target = private / 'runtime.env'
    if target.is_symlink() or not target.is_file():
        raise ConfigurationError('PRIVATE_RUNTIME_REQUIRED: no settings changed')
    original = target.read_bytes()
    try:
        lines = original.decode().splitlines()
        values = dict(line.split('=', 1) for line in lines if '=' in line and not line.lstrip().startswith('#'))
    except Exception:
        raise ConfigurationError('INVALID_PRIVATE_RUNTIME: no settings changed') from None
    key = values.get('OPENAI_API_KEY', '').strip()
    check_project(project, key, opener)
    matches = [line for line in lines if re.match(r'^\s*MIRKAM_LIVE_PROJECT_ID\s*=', line)]
    if matches == ['MIRKAM_LIVE_PROJECT_ID=' + project]:
        return False
    backup = private / ('runtime.env.before-live-project-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(original)
        out.flush()
        os.fsync(out.fileno())
    updated = [line for line in lines if not re.match(r'^\s*MIRKAM_LIVE_PROJECT_ID\s*=', line)]
    updated.append('MIRKAM_LIVE_PROJECT_ID=' + project)
    fd, temporary = tempfile.mkstemp(prefix='.live-project-', dir=private)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write('\n'.join(updated) + '\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return True

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--project', required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run on the VPS as root')
    try:
        prepare(args.project)
    except ConfigurationError as error:
        raise SystemExit(str(error)) from None
    print('LIVE_PROJECT_MODEL_ACCESS_OK: project saved; application restart required. Voice permission and SIP routing are NOT verified. No audio or calls generated.')
