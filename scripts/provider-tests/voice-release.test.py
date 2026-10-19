"""Exercise the actual release script against Docker doubles; no host changes."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / 'deploy/apply-voice-experience.sh'
DOCKER = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
p=Path(os.environ['MOCK_STATE']);s=json.loads(p.read_text());a=sys.argv[1:];op=a[0]
def find(name):
 for key,v in s.items():
  if key==name or v['id']==name:return key,v
 sys.exit(1)
if op=='inspect':
 key,v=find(a[-1]);print(v['id'] if a[2]=='{{.Id}}' else str(v['running']).lower());sys.exit(0)
if op=='stop':key,v=find(a[-1]);v['running']=False
elif op=='start':key,v=find(a[-1]);v['running']=True
elif op=='rename':
 key,v=find(a[1])
 if a[2] in s:sys.exit(1)
 del s[key];s[a[2]]=v
elif op=='logs':
 key,v=find(a[-1]);print(v.get('logs',''));sys.exit(0)
elif op=='make-app':s['mirkam-line']={'id':'app-new','running':True}
elif op=='make-bridge':
 mode=os.environ['MOCK_MODE'];logs='BRIDGE_START_FAILED' if mode=='registration-failure' else '' if mode=='registration-timeout' else 'VOICE_REGISTERED'
 s['mirkam-voice-elements']={'id':'bridge-new','running':True,'logs':logs}
else:sys.exit(2)
p.write_text(json.dumps(s))
'''

class ReleaseTest(unittest.TestCase):
    def run_release(self, mode):
        with tempfile.TemporaryDirectory(prefix='mirkam-release-test-') as root:
            root=Path(root);(root/'deploy').mkdir();(root/'bin').mkdir()
            shutil.copyfile(SCRIPT,root/'deploy/apply-voice-experience.sh')
            state=root/'state.json'
            state.write_text(json.dumps({'mirkam-line':{'id':'app-old','running':True},'mirkam-voice-elements':{'id':'bridge-old','running':True}}))
            programs={'docker':DOCKER,'id':'#!/bin/sh\necho 0\n','sleep':'#!/bin/sh\nexit 0\n'}
            for name,content in programs.items():
                path=root/'bin'/name;path.write_text(content);path.chmod(0o755)
            scripts={
                'build-voice-elements.sh':'[[ "$MOCK_MODE" != build-failure ]] || exit 42\n',
                'apply-management-release.sh':'docker stop mirkam-line\ndocker rename mirkam-line app-before\ndocker make-app\n[[ "$MOCK_MODE" != app-failure ]] || exit 43\n',
                'start-voice-elements.sh':'[[ "$MOCK_MODE" != bridge-failure ]] || exit 44\ndocker make-bridge\n'
            }
            for name,content in scripts.items():
                (root/'deploy'/name).write_text('#!/bin/bash\nset -e\n'+content)
            env={**os.environ,'PATH':str(root/'bin')+os.pathsep+os.environ['PATH'],'MOCK_STATE':str(state),'MOCK_MODE':mode}
            result=subprocess.run(['bash',str(root/'deploy/apply-voice-experience.sh')],env=env,capture_output=True,text=True,timeout=15)
            return result,json.loads(state.read_text())

    def test_failure_restores_matching_original_containers(self):
        for mode in ['app-failure','bridge-failure','registration-failure','registration-timeout']:
            with self.subTest(mode=mode):
                result,state=self.run_release(mode)
                self.assertNotEqual(result.returncode,0,result.stdout)
                self.assertEqual(state['mirkam-line'],{'id':'app-old','running':True})
                self.assertEqual(state['mirkam-voice-elements'],{'id':'bridge-old','running':True})
                self.assertIn('VOICE_RELEASE_FAILED',result.stderr)
                self.assertNotIn('VOICE_RELEASE_REGISTERED',result.stdout)

    def test_build_failure_does_not_stop_services(self):
        result,state=self.run_release('build-failure')
        self.assertEqual(result.returncode,42)
        self.assertEqual(state['mirkam-line'],{'id':'app-old','running':True})
        self.assertEqual(state['mirkam-voice-elements'],{'id':'bridge-old','running':True})
        self.assertEqual(len(state),2)

    def test_success_requires_registration_and_keeps_previous_containers(self):
        result,state=self.run_release('success')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertEqual(state['mirkam-line']['id'],'app-new')
        self.assertEqual(state['mirkam-voice-elements']['id'],'bridge-new')
        self.assertIn('VOICE_RELEASE_REGISTERED',result.stdout)
        self.assertEqual(next(v for v in state.values() if v['id']=='bridge-old')['running'],False)

if __name__=='__main__':
    unittest.main()
