# Chosen voice → telephone WAV: isolated feasibility experiment

Status: **live proof pending on the existing server**. User screenshot confirms
SERVER_OK, VOICE_KEY_CONFIGURED=true and VOICE_PROJECT_CONFIGURED=true in the
running app container. This workspace itself still has no OpenAI credentials.
Not a production speech adapter. No application imports this directory.

The hypothesis is that GPT-Live output can be captured into a WAV and passed
through the same ffmpeg conversion used by the existing Voice Elements bridge,
avoiding its unsupported Linux streaming component **for a bounded sample**.
This does not solve continuous calls, faithful reading of arbitrary documents,
latency, DTMF interaction or reliable utterance completion. Live's WebSocket
does not provide an output-audio-done event; a 12-second capture can truncate
speech or include silence. Do not deploy this as a replacement for TTS.

## Run in a trusted environment with the existing project's credentials

Requirements: Python 3.11+, `websockets==16.0`, ffmpeg.
Supply existing `OPENAI_API_KEY` and, if configured, `MIRKAM_LIVE_PROJECT_ID`
through the environment. Do not paste keys into chat or command arguments.

```sh
python3 probe.py --live
```

One billable session, no automatic retries, fixed custom voice, no caller audio,
business tools, new voice creation, phone routing, service restart or settings
changes. Startup/observation/finalization windows are bounded. Failure to confirm
close is reported; do not repeat such a run until provider cleanup is checked.
Network/process failure can prevent provider cleanup despite local timeouts.

Output goes into a new private `/tmp/mirkam-chosen-voice-proof-*` directory:
24kHz source WAV, converted mono 8kHz PCM16 WAV, and an evidence JSON file.
Listen to both files to check identity, intelligibility and complete wording.
Only an actual subsequent telephone playback establishes phone compatibility.
No generated audio exists until an authenticated live run succeeds.

## Existing server launcher

`bash run-server.sh` runs this experiment once on the existing Docker host.
It uses the installed app/bridge image IDs in temporary containers, installs
websockets into a private experiment venv and reads only the two required
credentials from the running app. It never mounts production data or restarts
services. The credential file is mode 0600 inside a new mode 0700 directory and
is removed on normal/error exit. The sample and evidence stay private under
`/root/mirkam-chosen-voice-proof.*`. A killed host/process can prevent cleanup.
No new voice is created. This performs one billable Live sample.

The launcher captures audio, converts it using the installed bridge image's
ffmpeg and validates the output with Python wave. PHONE_PLAYBACK_NOT_YET_TESTED
is deliberate: no telephone audio is injected and no live call is claimed.
The container launcher has not been exercised against the user's Docker host.

## Local tests (not a live voice proof)

```sh
python3 -m unittest -v test_probe.py
```

Tests exercise configuration validation, bad/bounded audio, incomplete sessions,
cleanup, and actual ffmpeg conversion of an explicitly synthetic sine wave.
WebSocket provider events are mocked. Never label the test tone as the chosen voice.

References checked 2026-11-14:
- https://developers.openai.com/api/docs/guides/voice-websockets
- https://developers.openai.com/api/docs/guides/live-conversations
- Existing `integrations/voice-elements/Program.cs`, `ConvertSpeech`.

## Live attempt and corrected greeting sequence (2026-11-14)
The user ran 721e800 on the server. Diagnostics showed all requested model,
voice and format checks true, no provider error, session closed, and 584640
zero-valued audio bytes (12.18 seconds): SILENT_AUDIO. No voice playback proved.
The experiment had omitted continuous input and the post-start greeting request.
It now sends paced 20ms silent PCM frames and exactly one
session.commentary.append after session.started, matching startup instructions.
Sender/receiver tasks stop before session.close, and failures propagate.
Fifteen local tests pass; provider events are simulated. The revised sequence
has not been verified against live audio yet. No production changes.
Reference: https://developers.openai.com/api/docs/guides/live-conversations#greet-before-the-caller-speaks
