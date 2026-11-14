"""Isolated, bounded Live-to-WAV experiment. Never imported by production.

Requires Python 3.11+, websockets 16 and ffmpeg. Uses existing environment
credentials; does not create a voice, route calls or edit server settings.
"""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.request
import urllib.parse
import wave

VOICE = 'voice_6ad601faaa188191aa00d6384fc09ca8'
PHRASE = 'שלום, כאן ליין, עוזרת הבינה המלאכותית של מרקם ליין. זו בדיקת קול.'
RATE = 24000
MAX_BYTES = RATE * 2 * 30


def configuration():
    return {
        'model': 'gpt-live-1', 'store': False,
        'instructions': 'דברי בעברית ישראלית טבעית. הקריאי רק את משפט הבדיקה שניתן, פעם אחת, ואז המתיני בשקט. אין כלים או פעולות לביצוע.',
        'audio': {'format': {'type': 'audio/pcm', 'rate': RATE},
                  'output': {'voice': {'id': VOICE}}},
        'delegation': {'type': 'client'},
        'input': [{'type': 'message', 'role': 'developer',
                   'content': [{'type': 'input_text', 'text': 'הקריאי עכשיו: ' + PHRASE}]}],
    }


class Capture:
    def __init__(self):
        self.session_id = None
        self.started = False
        self.closed = False
        self.audio = bytearray()
        self.transcript = ''

    def accept(self, event):
        kind = event.get('type')
        if kind == 'session.started':
            session = event.get('session', {})
            sid = session.get('id')
            if not isinstance(sid, str) or not 1 <= len(sid) <= 512:
                raise ValueError('INVALID_SESSION')
            self.session_id = sid  # retain for cleanup even if configuration differs
            audio = session.get('audio', {})
            if (audio.get('format') != {'type': 'audio/pcm', 'rate': RATE}
                    or audio.get('output', {}).get('voice') != {'id': VOICE}
                    or session.get('model') != 'gpt-live-1'):
                raise ValueError('RESOLVED_CONFIGURATION_MISMATCH')
            if self.started:
                raise ValueError('DUPLICATE_START')
            self.started = True
        elif kind == 'error':
            raise ValueError('PROVIDER_ERROR')  # never print provider payloads
        elif kind == 'session.output_audio.delta':
            if not self.started or self.closed:
                raise ValueError('AUDIO_OUTSIDE_SESSION')
            chunk = base64.b64decode(event.get('delta', ''), validate=True)
            if len(self.audio) + len(chunk) > MAX_BYTES:
                raise ValueError('AUDIO_LIMIT')
            self.audio.extend(chunk)
        elif kind == 'session.output_transcript.delta':
            delta = event.get('delta', '')
            if not isinstance(delta, str) or len(self.transcript) + len(delta) > 12000:
                raise ValueError('TRANSCRIPT_LIMIT')
            self.transcript += delta
        elif kind == 'session.closed':
            self.closed = True

    def validate(self):
        if not self.started or not self.closed:
            raise ValueError('SESSION_NOT_FINALIZED')
        if len(self.audio) < RATE or len(self.audio) % 2:
            raise ValueError('AUDIO_MISSING_OR_INCOMPLETE')
        if not any(self.audio):
            raise ValueError('SILENT_AUDIO')


def export(capture, directory, capture_only=False):
    capture.validate()
    directory = Path(directory)
    source = directory / 'live-24k.wav'
    target = directory / 'telephone-8k.wav'
    with wave.open(str(source), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(capture.audio)
    # The same conversion arguments as Program.cs ConvertSpeech.
    if not capture_only:
        subprocess.run(['ffmpeg', '-nostdin', '-hide_banner', '-loglevel', 'error',
                    '-y', '-i', str(source), '-ar', '8000', '-ac', '1',
                    '-c:a', 'pcm_s16le', str(target)], check=True, timeout=10,
                   capture_output=True)
        with wave.open(str(target), 'rb') as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 8000):
                raise ValueError('INVALID_TELEPHONE_FORMAT')
            if wav.getnframes() < 4000:
                raise ValueError('TELEPHONE_AUDIO_TOO_SHORT')
    report = {
        'voice': VOICE, 'capture_window_seconds': 12,
        'expected_phrase': PHRASE, 'provider_transcript': capture.transcript,
        'received_seconds': len(capture.audio) / (RATE * 2),
        'session_closed': capture.closed, 'converted_to_telephone_wav': not capture_only,
        'human_listening_verified': False, 'telephone_playback_verified': False,
        'verbatim_and_complete_verified': False,
        'note': 'Fixed observation window, NOT an utterance completion signal. No production integration.',
    }
    (directory / 'evidence.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))


def emergency_hangup(sid, headers):
    request = urllib.request.Request(
        'https://api.openai.com/v1/live/sessions/' + urllib.parse.quote(sid, safe='') + '/hangup',
        method='POST', headers=headers)
    # Never follow redirects carrying authorization headers.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(request, timeout=10) as response:
        return 200 <= response.status < 300


async def collect(headers):
    from websockets.asyncio.client import connect
    capture = Capture()
    try:
        # One attempt only. connect used as context manager, not reconnect iterator.
        async with connect('wss://api.openai.com/v1/live/sessions',
                           additional_headers=headers, open_timeout=10,
                           close_timeout=2, max_size=1024*1024) as socket:
            try:
                await socket.send(json.dumps({'type': 'session.start', 'session': configuration()}))
                async with asyncio.timeout(10):
                    while not capture.started:
                        capture.accept(json.loads(await socket.recv()))
                        if capture.closed:
                            raise ValueError('CLOSED_BEFORE_START')
                try:
                    async with asyncio.timeout(12):
                        while not capture.closed:
                            capture.accept(json.loads(await socket.recv()))
                except TimeoutError:
                    pass  # observation window only; not proof of complete speech
            finally:
                if not capture.closed:
                    await socket.send(json.dumps({'type': 'session.close'}))
                    async with asyncio.timeout(5):
                        while not capture.closed:
                            capture.accept(json.loads(await socket.recv()))
    finally:
        if not capture.closed:
            confirmed = False
            if capture.session_id:
                try:
                    confirmed = await asyncio.to_thread(emergency_hangup, capture.session_id, headers)
                except Exception:
                    pass
            print('CLEANUP_HANGUP_CONFIRMED' if confirmed else 'CLEANUP_UNCONFIRMED_DO_NOT_REPEAT')
    capture.validate()
    return capture


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true', help='Run one billable Live session; no telephone call')
    parser.add_argument('--output-parent', default='/tmp')
    parser.add_argument('--capture-only', action='store_true', help='Leave conversion to isolated existing bridge image')
    args = parser.parse_args()
    if not args.live:
        parser.error('--live is required; this makes one billable provider request')
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        print('BLOCKED: OPENAI_API_KEY is absent; no provider request made')
        return 2
    headers = {'Authorization': 'Bearer ' + key}
    project = os.environ.get('MIRKAM_LIVE_PROJECT_ID')
    if project:
        headers['OpenAI-Project'] = project
    os.umask(0o077)
    try:
        capture = asyncio.run(collect(headers))
        folder = tempfile.mkdtemp(prefix='mirkam-chosen-voice-proof-', dir=args.output_parent)
        export(capture, folder, capture_only=args.capture_only)
        print(('AUDIO_CAPTURED' if args.capture_only else 'AUDIO_CAPTURED_AND_CONVERTED')
              + ' (not telephone acceptance): ' + folder)
        return 0
    except Exception as error:
        print('PROOF_FAILED: ' + type(error).__name__ + '; no production change')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
