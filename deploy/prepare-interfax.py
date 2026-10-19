#!/usr/bin/env python3
"""Configure the fax pilot on the VPS; no network request or fax is sent."""
import getpass
import os
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def main():
    if os.geteuid() != 0:
        raise SystemExit('Run on the VPS as root.')
    target = Path('/opt/mirkam-private/runtime.env')
    if not target.is_file() or target.is_symlink():
        raise SystemExit('Existing private runtime environment is required.')
    username = getpass.getpass('InterFAX API username (hidden): ')
    password = getpass.getpass('InterFAX API password (hidden): ')
    number = input('Approved test fax number in +country format: ').strip()
    if not username or ':' in username or not password or any(c in username+password for c in '\r\n\x00'):
        raise SystemExit('Invalid credentials; nothing changed.')
    if not re.fullmatch(r'\+[1-9][0-9]{7,14}', number):
        raise SystemExit('Invalid test fax number; nothing changed.')
    values = {'MIRKAM_FAX_PROVIDER': 'interfax', 'INTERFAX_USERNAME': username,
              'INTERFAX_PASSWORD': password, 'MIRKAM_FAX_TEST_NUMBER': number}
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
    print('FAX_PILOT_CONFIG_READY: application restart required; no fax sent or account access verified.')

if __name__ == '__main__':
    main()
