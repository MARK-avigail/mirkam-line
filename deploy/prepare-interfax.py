#!/usr/bin/env python3
"""Verify account access with GET, then configure the subscription; no fax is sent."""
import getpass
import argparse
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from interfax_access import AccessError, verify_account


def main(credentials_only=False, pilot=False):
    if os.geteuid() != 0:
        raise SystemExit('Run on the VPS as root.')
    target = Path('/opt/mirkam-private/runtime.env')
    if not target.is_file() or target.is_symlink():
        raise SystemExit('Existing private runtime environment is required.')
    username = getpass.getpass('InterFAX API username (hidden): ')
    password = getpass.getpass('InterFAX API password (hidden): ')
    if not username or ':' in username or not password or any(c in username+password for c in '\r\n\x00'):
        raise SystemExit('Invalid credentials; nothing changed.')
    try:
        verify_account(username, password)
    except AccessError as error:
        raise SystemExit(str(error) + ': nothing changed; no fax sent.') from None
    values = {'INTERFAX_USERNAME': username, 'INTERFAX_PASSWORD': password}
    if not credentials_only and pilot:
        number = input('Approved test fax number in +country format: ').strip()
        if not re.fullmatch(r'\+[1-9][0-9]{7,14}', number):
            raise SystemExit('Invalid test fax number; nothing changed.')
        values.update({'MIRKAM_FAX_PROVIDER': 'interfax', 'MIRKAM_FAX_MODE': 'pilot', 'MIRKAM_FAX_TEST_NUMBER': number})
    elif not credentials_only:
        values.update({'MIRKAM_FAX_PROVIDER': 'interfax', 'MIRKAM_FAX_MODE': 'live', 'MIRKAM_FAX_INBOUND_ENABLED': 'true'})
    lines = target.read_text().splitlines()
    lines = [line for line in lines if line.split('=', 1)[0].strip() not in values]
    lines += [key+'='+value for key, value in values.items()]
    backup = target.with_name('runtime.env.before-fax-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f'))
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as out, target.open('rb') as source:
        shutil.copyfileobj(source, out)
    fd, temp = tempfile.mkstemp(prefix='.fax-env-', dir=target.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write('\n'.join(lines)+'\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print('FAX_ACCOUNT_ACCESS_OK: '+('credentials saved; delivery mode was not changed.' if credentials_only else ('pilot configuration saved.' if pilot else 'subscription sending configuration saved.'))+' Application restart required to load settings. No fax sent or delivery verified. Incoming account access and delivery still require verification.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument('--credentials-only', action='store_true')
    modes.add_argument('--pilot', action='store_true')
    args = parser.parse_args()
    main(args.credentials_only, args.pilot)
