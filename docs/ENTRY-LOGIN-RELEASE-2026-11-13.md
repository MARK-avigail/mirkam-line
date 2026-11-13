# Entry and retry-loop release — 2026-11-13

Based on f7b5ea8a1b45854a5ec87367e4c0ac0047e7dbec.

## Behavior
- Keep both six-digit credentials and existing identity lockout rules.
- Shorten login prompts. Return to user-code entry after an incorrect credential pair so either credential can be corrected; do not reveal which credential was wrong.
- End after three incorrect pairs or three incomplete inputs. Bound silent login repetitions.
- Preserve the active waiting prompt nonce when asynchronous processing fails, so exit/main-menu navigation remains usable. A waiting-stage keypress cannot approve a retry before the error menu is presented.
- Optional entry gate: when MIRKAM_ENTRY_PROMPT is configured, play it once, accept only # to reach login, and hang up after eight seconds without input or on another key. The gate does not replace authentication. It remains disabled until the greeting is provided and configured.

## Scope
No provider, PBX, fax, voice-selection, recording-retention, or playback changes. The separate local recording-label correction is not included.

## Validation and deployment boundary
The exact release candidate passed 3,362 Node tests across 31 files in isolated processes. No live provider was called. C# bridge code is unchanged. No live DTMF or audio-playback claim follows from these tests.

Publishing this revision does not install it on the server. Last confirmed installed revision: f7b5ea8. Keep existing private configuration, data and encryption keys. Deploy with the existing deploy/apply-voice-experience.sh procedure during an idle period; it restarts the service and bridge.

Acceptance still required after installation: correct login; correcting an incorrect user code; bounded invalid/silent input; main-menu navigation after processing failure. Test the # gate only after configuring its final greeting. Missing recordings, the approximately five-minute disconnect, final telephone voice and live fax delivery remain open.
