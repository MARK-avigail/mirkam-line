# Voice Elements inbound bridge — build and live acceptance pending

This adapter runs alongside the existing Mirkam Line server. It interprets the
existing voice workflow (Say, Gather, Record, Redirect, Pause, Hangup) rather than
replacing the application with the provider's demo. No outbound dial/transfer API
is used. A build is not proof that SDK login or telephony works.

## Current verification

- Node endpoints tested locally with provider test doubles: independent bridge
  authentication, code/PIN login, recording ownership and nonce binding, bounded
  WAV upload, transcription/chat workflow, audio cleanup and call-end revocation.
- Existing Twilio endpoints still require their own Twilio signatures.
- .NET build and SDK runtime NOT verified in this workspace. The sample's pinned
  `InventiveLabs.VoiceElementsClient` 9.1.1-pre is old; .NET 8 compatibility and
  provider connectivity must be verified before enabling the bridge. NuGet lists
  computed net8 compatibility, which is not a runtime test.
- Do not call the assigned US number until registration and calling charges have
  been checked. Trial minutes do not guarantee free international dialing or AI.

## First gate: build only

Run `bash deploy/build-voice-elements.sh` on the existing Docker host. This does
not restart the application, load credentials or place a call. Expected success:
`VOICE_BRIDGE_BUILD_OK <revision>`. If compilation fails, stop and fix the exact
failure; do not replace production with the vendor sample or an old runtime.

## Runtime configuration (after successful build)

Keep these settings private, outside Git and the Docker build context:

- Application `VOICE_ELEMENTS_BRIDGE_TOKEN`: a separate random secret, at least
  32 characters. Unset by default, so all bridge endpoints reject requests.
- Bridge `VOICE_ELEMENTS_BRIDGE_TOKEN`: same value, never the admin token.
- Bridge `MIRKAM_BRIDGE_BASE_URL`: application origin, HTTPS or loopback HTTP only.
- Bridge `VOICE_ELEMENTS_SETTINGS_FILE`: read-only mounted customer appsettings
  file from the uploaded demo, readable by container UID 1000.
- The application already owns the OpenAI key; do not pass it to the bridge.

No credentials are embedded in these sources. The .dockerignore excludes all
files except the project, source and Dockerfile. Use a private tmpfs for /tmp to
hold short-lived audio, and no published inbound ports on the bridge container.
Default bridge concurrency is two inbound calls, with a twenty-minute limit per
call. Do not automatically restart a registration failure in an unbounded loop.

## Acceptance gates

1. Build succeeds. Deploy Node changes with the normal backup/rollback workflow.
2. Configure the dedicated secret privately, and register the bridge with the
   provider. `VOICE_REGISTERED` proves SDK registration only.
3. Call manually with a test account. Verify Hebrew audio and DTMF entry; PIN is
   not recorded by our workflow and must not be enabled in SDK diagnostic logs.
4. Branch 3: record a question, hear an actual AI answer, confirm the conversation
   is visible under that test customer's account in management.
5. End the call: session revoked and temporary chat audio removed. Repeat with
   a saved draft: filling audio is stored encrypted under existing retention.
6. Verify restart, timeout, wrong PIN, disconnected caller, stale recording and
   service outage. No fax delivery is claimed by this bridge.

Open issues until live acceptance: SDK compatibility and TLS/transport behavior,
provider-side audio cache lifetime, Hebrew voice quality/latency, silent recording
termination (Record currently uses the maximum duration or #), and reliable SDK
registration recovery. All need evidence before launch.

## Prepared activation scripts (run only after the build gate passes)

`deploy/prepare-voice-elements.py /path/to/IVRTransfer_Core.zip` runs as root on
VPS. It validates the downloaded customer configuration, keeps the first runtime
environment backup, preserves existing settings and creates/reuses a separate
bridge token. It does not start calls. Supply the original private ZIP on the
server; never commit it or put it in the Docker build context.

Then the normal `deploy/apply-management-release.sh` loads that environment into
the application. Finally `deploy/start-voice-elements.sh` verifies the authenticated
backend readiness protocol and starts a separate, non-root, constrained bridge
container sharing the application's network namespace. No new public port is
opened. Registration logs still need review before an inbound test.

The bridge uses a private tmpfs for temporary audio and has automatic restarts
disabled during acceptance. If an application release replaces the container,
stop and recreate the bridge to join the new network namespace; do not leave it
attached to the retired application's container. Stop with
`docker stop mirkam-voice-elements`. Preserve the private configuration and data.

Configuration tests: `python3 scripts/provider-tests/voice-private-config.test.py`.
These tests use fabricated credentials and temporary directories only.
