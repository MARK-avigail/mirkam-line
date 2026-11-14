import asyncio
import base64
import json
import math
import struct
import tempfile
import unittest
import wave
from unittest.mock import patch
import probe


def start():
    return {'type': 'session.started', 'session': {'id': 'test-session', **probe.configuration()}}


def synthetic_audio():
    # Explicitly synthetic test tone, NEVER evidence of the selected voice.
    return b''.join(struct.pack('<h', int(9000 * math.sin(2 * math.pi * 440 * i / 24000)))
                    for i in range(24000))


class Socket:
    def __init__(self, events):
        self.events = iter(events)
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def send(self, value):
        self.sent.append(json.loads(value))

    async def recv(self):
        return json.dumps(next(self.events))


class ProofTests(unittest.TestCase):
    def test_selected_voice_has_no_business_tools(self):
        config = probe.configuration()
        self.assertEqual(config['audio']['output']['voice'], {'id': probe.VOICE})
        self.assertFalse(config['store'])
        self.assertEqual(config['delegation'], {'type': 'client'})

    def test_wrong_voice_fails_and_retains_cleanup_id(self):
        capture = probe.Capture()
        event = start()
        event['session']['audio']['output']['voice'] = 'coral'
        with self.assertRaisesRegex(ValueError, 'MISMATCH'):
            capture.accept(event)
        self.assertEqual(capture.session_id, 'test-session')

    def test_invalid_audio_and_limit(self):
        capture = probe.Capture()
        capture.accept(start())
        with self.assertRaises(ValueError):
            capture.accept({'type': 'session.output_audio.delta', 'delta': '!!!'})
        with patch.object(probe, 'MAX_BYTES', 2), self.assertRaisesRegex(ValueError, 'LIMIT'):
            capture.accept({'type': 'session.output_audio.delta', 'delta': base64.b64encode(b'abcd').decode()})

    def test_unclosed_or_empty_capture_cannot_pass(self):
        capture = probe.Capture()
        capture.accept(start())
        with self.assertRaisesRegex(ValueError, 'FINALIZED'):
            capture.validate()
        capture.closed = True
        with self.assertRaisesRegex(ValueError, 'MISSING'):
            capture.validate()

    def test_real_ffmpeg_conversion_on_synthetic_tone(self):
        capture = probe.Capture()
        capture.accept(start())
        capture.audio.extend(synthetic_audio())
        capture.closed = True
        with tempfile.TemporaryDirectory() as folder:
            probe.export(capture, folder)
            with wave.open(folder + '/telephone-8k.wav', 'rb') as wav:
                self.assertEqual((wav.getnchannels(), wav.getsampwidth(), wav.getframerate()), (1, 2, 8000))
                self.assertEqual(wav.getnframes(), 8000)
            with open(folder + '/evidence.json') as source:
                evidence = json.load(source)
            self.assertFalse(evidence['telephone_playback_verified'])
            self.assertFalse(evidence['verbatim_and_complete_verified'])

    def test_mock_transport_captures_and_finalizes(self):
        socket = Socket([start(), {'type': 'session.output_audio.delta',
                                  'delta': base64.b64encode(synthetic_audio()).decode()},
                         {'type': 'session.closed'}])
        with patch('websockets.asyncio.client.connect', return_value=socket) as connection:
            result = asyncio.run(probe.collect({'Authorization': 'Bearer test-only'}))
        self.assertTrue(result.closed)
        self.assertEqual(len(result.audio), 48000)
        self.assertEqual(connection.call_count, 1)

    def test_capture_only_does_not_claim_conversion(self):
        capture = probe.Capture()
        capture.accept(start())
        capture.audio.extend(synthetic_audio())
        capture.closed = True
        with tempfile.TemporaryDirectory() as folder, patch('probe.subprocess.run') as convert:
            probe.export(capture, folder, capture_only=True)
            convert.assert_not_called()
            with open(folder + '/evidence.json') as source:
                self.assertFalse(json.load(source)['converted_to_telephone_wav'])

    def test_provider_error_closes_without_retry(self):
        socket = Socket([start(), {'type': 'error'}, {'type': 'session.closed'}])
        with patch('websockets.asyncio.client.connect', return_value=socket) as connection:
            with self.assertRaisesRegex(ValueError, 'PROVIDER_ERROR'):
                asyncio.run(probe.collect({}))
        self.assertEqual(connection.call_count, 1)
        self.assertEqual(socket.sent[-1], {'type': 'session.close'})

    def test_broken_transport_attempts_hangup_once(self):
        socket = Socket([start()])
        with patch('websockets.asyncio.client.connect', return_value=socket), \
                patch.object(probe, 'emergency_hangup', return_value=True) as hangup:
            with self.assertRaises(RuntimeError):
                asyncio.run(probe.collect({}))
        hangup.assert_called_once_with('test-session', {})


if __name__ == '__main__':
    unittest.main()
