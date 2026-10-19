#!/usr/bin/env python3
"""Select a supported telephone TTS voice; never read or change API credentials."""
import argparse
import os
from pathlib import Path
import re
import tempfile

VOICES = ('marin', 'coral', 'shimmer')

def select_voice(voice, private=Path('/opt/mirkam-private')):
    if voice not in VOICES:
        raise ValueError('Unsupported telephone TTS voice')
    target = private / 'runtime.env'
    if target.is_symlink() or not target.is_file():
        raise ValueError('Existing private runtime environment is required')
    original = target.read_bytes()
    lines = original.decode().splitlines()
    selected = [line for line in lines if re.match(r'^\s*MIRKAM_TTS_VOICE\s*=', line)]
    if selected == ['MIRKAM_TTS_VOICE=' + voice]:
        return False
    backup = private / 'runtime.before-telephone-voice.env'
    if backup.is_symlink():
        raise ValueError('Invalid private backup path')
    try:
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        if not backup.is_file():
            raise ValueError('Invalid private backup path')
    else:
        with os.fdopen(fd, 'wb') as out:
            out.write(original)
            out.flush()
            os.fsync(out.fileno())
    lines = [line for line in lines if not re.match(r'^\s*MIRKAM_TTS_VOICE\s*=', line)]
    lines.append('MIRKAM_TTS_VOICE=' + voice)
    fd, temp = tempfile.mkstemp(prefix='.telephone-voice-', dir=private)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write('\n'.join(lines) + '\n')
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, target)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    return True

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('voice', choices=VOICES)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run on the VPS as root')
    select_voice(args.voice)
    print('TELEPHONE_VOICE_SELECTED=' + args.voice + ': restart application and bridge; no audio or call tested')
