#!/usr/bin/env python3
"""Prepare private provider configuration from the downloaded ZIP, without starting calls."""
import json, os, secrets, sys, tempfile, zipfile
from pathlib import Path

def atomic(path, data, uid=None):
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(data); out.flush(); os.fsync(out.fileno())
        os.chmod(tmp, 0o600)
        if uid is not None: os.chown(tmp, uid, uid)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)

def prepare(archive, private, chown=False):
    private=Path(private)
    if not private.is_dir() or private.is_symlink(): raise ValueError('Private directory missing or invalid')
    runtime=private/'runtime.env'
    if not runtime.is_file() or runtime.is_symlink(): raise ValueError('Existing runtime.env required')
    text=runtime.read_text()
    with zipfile.ZipFile(archive) as z:
        names=[n for n in z.namelist() if n.replace('\\','/').endswith('VoiceApp/appsettings.json')]
        if len(names)!=1 or z.getinfo(names[0]).file_size>100000: raise ValueError('Expected one bounded customer settings file')
        data=json.loads(z.read(names[0]).decode('utf-8-sig'))
    section=data.get('ApplicationSettings',{}).get('VoiceElementsTest',{})
    if not all(isinstance(section.get(k),str) and section[k].strip() for k in ['PhoneServer','Username','Password']): raise ValueError('Customer configuration incomplete')
    existing=[line.split('=',1)[1].strip() for line in text.splitlines() if line.startswith('VOICE_ELEMENTS_BRIDGE_TOKEN=')]
    if len(existing)>1: raise ValueError('Duplicate bridge token entries')
    token=existing[0] if existing else secrets.token_hex(32)
    if len(token)<32 or any(c.isspace() for c in token) or any(c in token for c in "'\""): raise ValueError('Invalid bridge token format')
    folder=private/'voice-elements'
    if folder.is_symlink(): raise ValueError('Invalid provider directory')
    folder.mkdir(mode=0o700,exist_ok=True);os.chmod(folder,0o700)
    backup=folder/'runtime.before-voice-elements.env'
    if not backup.exists(): atomic(backup,text)
    atomic(folder/'appsettings.json',json.dumps(data),1000 if chown else None)
    env='VOICE_ELEMENTS_BRIDGE_TOKEN='+token+'\nMIRKAM_BRIDGE_BASE_URL=http://127.0.0.1:3000/\nVOICE_ELEMENTS_SETTINGS_FILE=/run/provider/appsettings.json\n'
    atomic(folder/'bridge.env',env)
    if not existing: atomic(runtime,text.rstrip('\n')+'\nVOICE_ELEMENTS_BRIDGE_TOKEN='+token+'\n')
    return folder

if __name__=='__main__':
    if os.geteuid()!=0: sys.exit('Run on VPS as root')
    if len(sys.argv)!=2: sys.exit('Usage: prepare-voice-elements.py /path/to/IVRTransfer_Core.zip')
    try:
        prepare(sys.argv[1],'/opt/mirkam-private',chown=True)
        print('VOICE_PRIVATE_CONFIG_READY — no calls started; application restart still required')
    except Exception as e:
        # Do not echo exceptions containing file contents or customer credentials.
        sys.exit('VOICE_CONFIG_FAILED: '+type(e).__name__)
