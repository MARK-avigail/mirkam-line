# Voice Elements support request — Linux bidirectional audio

Draft only; not sent. No customer credentials or recordings included.

Subject: Supported Linux bidirectional audio integration with VoiceElementsClient 9.8.3

We have an inbound Voice Elements cloud application running in a .NET 8 Linux Docker container. Registration and inbound IVR calls work. We need to exchange live caller audio and generated audio with a server-side WebSocket AI service (OpenAI GPT-Live, not the older Realtime API).

We inspected the installed InventiveLabs.VoiceElementsClient 9.8.3 package. Its separate VoiceElementsClientStreams.dll exposes MediaProcessor, StreamEvent and OutgoingStream. However, MediaProcessor.Init calls StreamingApplication.Start, which calls Windows native timing functions (winmm.dll and Kernel32.dll). This is not a usable Linux streaming path as shipped.

Please provide the supported Linux integration sample and answer:

1. Is a Linux-compatible MediaProcessor package available? Which package/version and native dependencies?
2. Alternatively, can the existing cloud account stream bidirectional audio to a customer WebSocket endpoint? Please provide the exact start/media/stop/DTMF message schema, authentication, codec, sample rate and playback interruption/queue-clearing behavior.
3. If the supported transport is RTP, please provide a complete SetMonitorStream/GetMonitorStream or SipChannel example, including supported streamMode values, whether audio sent back is played to the caller, remote peer validation, NAT/firewall ports and returning safely to IVR. We do not want to guess these settings.
4. Does this require account enablement, a different product or a license change? Please identify any cost before activation.
5. Calls have ended while audio was playing at roughly 303 seconds with VoiceElements.Common.HangupException. Does this trial account impose a 300-second call cap? If not, which privacy-preserving provider diagnostics identify the hangup initiator?

We need to retain our existing authentication and explicit approval before sending documents/messages. The AI service must not bypass those controls. A generic legacy OpenAI Realtime example alone will not establish compatibility with GPT-Live.

Please send a runnable minimal example without embedding credentials. We can supply account identification through your authenticated support channel.

Preferred alternative to investigate: can our existing inbound number be routed through your SIP trunk product directly to OpenAI GPT-Live, with TLS signaling and SRTP media? Please confirm eligibility of the current trial account, whether the same number can be retained, required codecs, configuration steps and any additional charges. We have not authorized activation or number migration.
