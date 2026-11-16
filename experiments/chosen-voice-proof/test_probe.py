import asyncio
import base64
import json
import contextlib
import io
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

    def test_failure_diagnostics_distinguish_wrong_configuration(self):
        event = start()
        event['session']['model'] = 'different-model'
        socket = Socket([event, {'type': 'session.closed'}])
        diagnostics = {}
        with patch('websockets.asyncio.client.connect', return_value=socket):
            with self.assertRaisesRegex(ValueError, 'RESOLVED_CONFIGURATION_MISMATCH'):
                asyncio.run(probe.collect({}, diagnostics))
        self.assertFalse(diagnostics['model_matches'])
        self.assertTrue(diagnostics['voice_matches'])
        self.assertTrue(diagnostics['closed'])

    def test_provider_diagnostics_never_echo_messages_or_unknown_values(self):
        capture = probe.Capture()
        with self.assertRaisesRegex(ValueError, 'PROVIDER_ERROR'):
            capture.accept({'type': 'error', 'error': {
                'code': 'private-key-test', 'type': 'invalid_request_error',
                'param': 'private-key-test', 'message': 'private-key-test'}})
        self.assertNotIn('private-key-test', json.dumps(capture.diagnostics))
        self.assertEqual(capture.diagnostics['provider_type'], 'invalid_request_error')
        self.assertEqual(probe.failure_code(ValueError('private-key-test')), 'UNCLASSIFIED_ValueError')

    def test_cleanup_error_preserves_initial_failure(self):
        socket = Socket([start(), {'type': 'error'}])
        diagnostics = {}
        with patch('websockets.asyncio.client.connect', return_value=socket), \
                patch.object(probe, 'emergency_hangup', return_value=True):
            with self.assertRaisesRegex(ValueError, 'PROVIDER_ERROR'):
                asyncio.run(probe.collect({}, diagnostics))
        self.assertIn('cleanup_error', diagnostics)
        self.assertTrue(diagnostics['emergency_hangup_confirmed'])

    def test_live_start_sequence_includes_silence_and_one_greeting(self):
        socket = Socket([start(), {'type': 'session.commentary.appended'},
                         {'type': 'session.output_audio.delta',
                          'delta': base64.b64encode(synthetic_audio()).decode()},
                         {'type': 'session.closed'}])
        diagnostics = {}
        with patch('websockets.asyncio.client.connect', return_value=socket):
            asyncio.run(probe.collect({}, diagnostics))
        self.assertEqual([x['type'] for x in socket.sent[:3]],
                         ['session.start', 'session.input_audio.append', 'session.commentary.append'])
        greetings = [x for x in socket.sent if x['type'] == 'session.commentary.append']
        self.assertEqual(len(greetings), 1)
        self.assertIsNone(greetings[0]['delegation_id'])
        self.assertEqual(greetings[0]['content'], socket.sent[0]['session']['input'][0]['content'][0]['text'])
        self.assertEqual(base64.b64decode(socket.sent[1]['audio']), bytes(960))
        self.assertTrue(diagnostics['greeting_acknowledged'])

    def test_continuous_silence_is_paced_and_stops_on_close(self):
        capture = probe.Capture()
        socket = Socket([])
        delays = []
        async def sleep(delay):
            delays.append(delay)
            if len(delays) == 4:
                capture.closed = True
        with patch('probe.asyncio.sleep', side_effect=sleep):
            asyncio.run(probe.stream_silence(socket, capture))
        self.assertEqual(delays, [0.02] * 4)
        self.assertEqual(len(socket.sent), 3)
        self.assertEqual(capture.diagnostics['input_audio_frames'], 3)

    def test_zero_audio_is_still_failure_after_greeting(self):
        socket = Socket([start(), {'type': 'session.commentary.appended'},
                         {'type': 'session.output_audio.delta',
                          'delta': base64.b64encode(bytes(584640)).decode()},
                         {'type': 'session.closed'}])
        diagnostics = {}
        with patch('websockets.asyncio.client.connect', return_value=socket):
            with self.assertRaisesRegex(ValueError, 'SILENT_AUDIO'):
                asyncio.run(probe.collect({}, diagnostics))
        self.assertEqual(diagnostics['audio_bytes'], 584640)
        self.assertTrue(diagnostics['closed'])

    def test_handshake_rejection_does_not_claim_session_cleanup_failed(self):
        from websockets.exceptions import InvalidStatus
        from websockets.http11 import Response
        from websockets.datastructures import Headers
        error = InvalidStatus(Response(429, 'private-message', Headers()))
        output = io.StringIO()
        diagnostics = {}
        with patch('websockets.asyncio.client.connect', side_effect=error), \
                patch.object(probe, 'emergency_hangup') as hangup, contextlib.redirect_stdout(output):
            with self.assertRaises(InvalidStatus):
                asyncio.run(probe.collect({}, diagnostics))
        self.assertFalse(diagnostics['session_start_attempted'])
        hangup.assert_not_called()
        self.assertEqual(output.getvalue().strip(), 'SESSION_NOT_STARTED')
        self.assertEqual(probe.failure_code(error), 'HANDSHAKE_HTTP_429')


if __name__ == '__main__':
    unittest.main()
