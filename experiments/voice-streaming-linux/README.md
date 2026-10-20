# Isolated Linux streaming feasibility probe

This project is not part of the production bridge image and is never loaded during calls. It uses no credentials, account configuration or customer audio. Its only media packets are synthetic RTP sent over loopback.

SDK 9.8.3 imports five Windows APIs: QueryPerformanceCounter, QueryPerformanceFrequency, GetCurrentThreadId, timeBeginPeriod and timeEndPeriod. clock-compat.c implements their clock/thread semantics for a Linux experiment; it does not change provider time limits or licensing.

**Current result: unsuccessful.** The adapter compiled and its clock functions passed local checks. The production bridge still builds and its existing digit policy passes, but MediaProcessor.Init fails in UdpPort.InitPool with 250 port errors before any audio is confirmed. Metadata also shows Socket.IOControl calls in initialization/recycling. That is a further portability concern, not proof of the exact exception being swallowed by the SDK. The clock adapter is insufficient. Do not enable it in production or present initialization as successful live audio.

Run in an isolated Linux runner with .NET 8 and gcc:

```sh
dotnet publish experiments/voice-streaming-linux/Probe.csproj -c Release -o /tmp/mirkam-stream-probe
gcc -Wall -Wextra -Werror -fPIC -shared experiments/voice-streaming-linux/clock-compat.c -o /tmp/libmirkam-clock.so
dotnet /tmp/mirkam-stream-probe/Probe.dll --socket-api
timeout 15s dotnet /tmp/mirkam-stream-probe/Probe.dll /tmp/libmirkam-clock.so
```

Exit 0 requires receipt of nonempty synthetic audio. Exit 1 is initialization failure, 2 is missing audio, and 124 is the external timeout. CI retains the exploratory failure separately from compilation checks. No SIP routing or GPT-Live call is attempted.
