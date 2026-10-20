using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;
using VoiceElements.Client;

// Inbound calls only. No Dial/Transfer or outbound call API is used.
internal static class Program
{
    static readonly HttpClient Http = new(new HttpClientHandler { AllowAutoRedirect = false })
    { Timeout = TimeSpan.FromSeconds(35), MaxResponseContentBufferSize = 6 * 1024 * 1024 };
    static string? RecoveryAudio;
    sealed class SpeechUnavailableException : Exception { }
    static readonly SemaphoreSlim Slots = new(2, 2);
    static readonly ManualResetEventSlim Stop = new(false);
    static string Required(string key) => Environment.GetEnvironmentVariable(key) is { Length: > 0 } v ? v : throw new Exception("Missing setting: " + key);
    static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--streaming-native-api")
        {
            // Read-only metadata inspection. Do not initialize media, bind ports,
            // read settings, or contact either provider in this mode.
            var assembly = typeof(VoiceElements.Client.Streams.MediaProcessor).Assembly;
            foreach (var type in assembly.GetTypes().OrderBy(t => t.FullName))
            foreach (var method in type.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.DeclaredOnly))
            {
                var native = method.GetCustomAttributes(typeof(System.Runtime.InteropServices.DllImportAttribute), false)
                    .Cast<System.Runtime.InteropServices.DllImportAttribute>().SingleOrDefault();
                if (native != null)
                    Console.WriteLine($"STREAMING_NATIVE_IMPORT type={type.FullName} library={native.Value} entry={native.EntryPoint} signature={method}");
            }
            Console.WriteLine("STREAMING_NATIVE_API_INSPECTED: no provider connection or call attempted");
            return 0;
        }
        if (args.Length == 1 && args[0] == "--streaming-platform-check")
        {
            // Isolated native dependency probe. No settings, ports or provider calls.
            var streams = typeof(VoiceElements.Client.Streams.MediaProcessor).Assembly;
            var application = streams.GetType("VoiceElements.Client.Streams.StreamingApplication", true)!;
            var method = application.GetMethod("QueryPerformanceFrequency", System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)!;
            try
            {
                method.Invoke(null, new object[] { 0L });
                Console.WriteLine("STREAMING_NATIVE_TIMER_AVAILABLE: not proof of provider or audio connectivity");
            }
            catch (System.Reflection.TargetInvocationException error) when (error.InnerException is DllNotFoundException)
            {
                Console.WriteLine("STREAMING_NATIVE_TIMER_UNAVAILABLE: SDK streaming requires Windows native libraries; no provider call attempted");
                return OperatingSystem.IsLinux() ? 0 : 1;
            }
            return 0;
        }
        if (args.Length == 1 && args[0] == "--streaming-api")
        {
            // Reflection only: no provider connection, settings or credential reads.
            var assembly = typeof(VoiceResource).Assembly;
            Console.WriteLine("STREAMING_API_SDK=" + assembly.GetName().Version);
            var count = 0;
            foreach (var type in new[] { assembly, typeof(VoiceElements.Common.Codec).Assembly, typeof(VoiceElements.Interface.RtpType).Assembly, typeof(VoiceElements.Client.Streams.MediaProcessor).Assembly }.Distinct().SelectMany(a => a.GetExportedTypes()).OrderBy(t => t.FullName))
            {
                foreach (var member in type.GetMembers(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.DeclaredOnly))
                {
                    var name = type.Name + "." + member.Name;
                    if (type != typeof(VoiceResource) && type != typeof(SipChannel) && type != typeof(ChannelResource) && type != typeof(TelephonyServer) && !new[] { "Stream", "WebSocket", "Pipeline", "Nexus", "AudioData", "Media" }.Any(word => name.Contains(word, StringComparison.OrdinalIgnoreCase))) continue;
                    if (member is System.Reflection.MethodInfo accessor && accessor.IsSpecialName) continue;
                    if (++count > 600) { Console.WriteLine("STREAMING_API_TRUNCATED"); return 0; }
                    Console.WriteLine(type.FullName + " :: " + member.ToString());
                    if (member is System.Reflection.MethodBase method) Console.WriteLine("PARAMETERS " + type.Name + "." + method.Name + " " + string.Join(", ", method.GetParameters().Select(p => p.Name + ":" + p.ParameterType.Name)));
                }
            }
            Console.WriteLine("STREAMING_API_MEMBERS=" + count);
            return 0;
        }
        if (args.Length == 1 && args[0] == "--input-self-test") return VoiceInputPolicy.SelfTest();
        var stage = "environment";
        try
        {
            var origin = new Uri(Required("MIRKAM_BRIDGE_BASE_URL"));
            if (origin.AbsolutePath != "/" || !string.IsNullOrEmpty(origin.Query) || !string.IsNullOrEmpty(origin.UserInfo) ||
                (origin.Scheme != "https" && !(origin.Scheme == "http" && origin.IsLoopback))) throw new Exception("Use HTTPS or loopback HTTP");
            Http.BaseAddress = origin;
            var secret = Required("VOICE_ELEMENTS_BRIDGE_TOKEN");
            if (secret.Length < 32) throw new Exception("Bridge token is too short");
            Http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", secret);
            stage = "backend-readiness";
            using var readiness = JsonDocument.Parse(Post("/voice-elements/ready", Json(new { })));
            if (readiness.RootElement.GetProperty("protocol").GetInt32() != 1) throw new Exception("Unsupported bridge backend");
            // Read the downloaded customer settings at runtime. Never bake it into the image.
            stage = "provider-settings";
            using var config = JsonDocument.Parse(File.ReadAllText(Required("VOICE_ELEMENTS_SETTINGS_FILE")));
            var settings = config.RootElement.GetProperty("ApplicationSettings").GetProperty("VoiceElementsTest");
            stage = "provider-connect";
            using var server = new TelephonyServer(settings.GetProperty("PhoneServer").GetString(), settings.GetProperty("Username").GetString(), settings.GetProperty("Password").GetString());
            stage = "provider-initialize";
            server.CacheMode = VoiceElements.Interface.CacheMode.ClientSession;
            server.ConnectionLost += (_, _) => Console.WriteLine("VOICE_CONNECTION_LOST");
            server.ConnectionRestored += (_, _) => Console.WriteLine("VOICE_CONNECTION_RESTORED");
            server.NewCall += (_, e) =>
            {
                if (!Slots.Wait(0)) { try { e.ChannelResource.Disconnect(503); } finally { e.ChannelResource.Dispose(); } return; }
                try { Handle(e.ChannelResource); }
                catch { Console.WriteLine("CALL_FAILED: inspect bridge/application health; no caller data logged"); }
                finally { try { e.ChannelResource.Disconnect(); } catch { } try { e.ChannelResource.Dispose(); } catch { } Slots.Release(); }
            };
            // Prepare one generic recovery clip, without accounts or caller data.
            // Failure is non-fatal; no claim that the fallback is available then.
            try
            {
                var recoveryFolder = Path.Combine(Path.GetTempPath(), "mirkam-recovery-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(recoveryFolder);
                if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(recoveryFolder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
                RecoveryAudio = ConvertSpeech(Post("/voice-elements/recovery", Json(new { })), recoveryFolder, "recovery");
            }
            catch { Console.WriteLine("RECOVERY_AUDIO_UNAVAILABLE: speech errors may still end calls"); }
            stage = "provider-register";
            server.RegisterDNIS();
            Console.CancelKeyPress += (_, e) => { e.Cancel = true; Stop.Set(); };
            Console.WriteLine("VOICE_REGISTERED: ready for an inbound acceptance test; not proof of a completed call");
            Stop.Wait();
            return 0;
        }
        catch (Exception error)
        {
            // Never log Message, ToString, paths, URLs or configuration values: SDK errors may contain credentials.
            Console.Error.WriteLine($"BRIDGE_START_FAILED stage={stage}");
            Exception? current = error;
            for (var depth = 0; current != null && depth < 5; depth++, current = current.InnerException)
            {
                Console.Error.WriteLine($"CAUSE depth={depth} type={current.GetType().FullName} hresult=0x{current.HResult:X8}");
                // Method names only: omit argument values, exception messages and file paths.
                foreach (var frame in (new StackTrace(current, false).GetFrames() ?? Array.Empty<StackFrame>()).Take(6))
                {
                    var method = frame.GetMethod();
                    if (method != null) Console.Error.WriteLine($"FRAME={method.DeclaringType?.FullName}.{method.Name}");
                }
                if (current is HttpRequestException http && http.StatusCode is { } status)
                    Console.Error.WriteLine($"HTTP_STATUS={(int)status}");
                if (current is System.Net.Sockets.SocketException socket)
                    Console.Error.WriteLine($"SOCKET_ERROR={socket.SocketErrorCode}");
            }
            return 1;
        }
    }
    static string Target(string input)
    {
        if (!input.StartsWith("/voice/step", StringComparison.Ordinal)) throw new Exception("Unsupported callback");
        var uri = new Uri("http://localhost" + input);
        if (uri.AbsolutePath != "/voice/step") throw new Exception("Unsupported callback");
        return "/voice-elements/step" + uri.Query;
    }
    static byte[] Post(string path, HttpContent body)
    {
        using (body)
        using (var response = Http.PostAsync(path, body).GetAwaiter().GetResult())
        { response.EnsureSuccessStatusCode(); return response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult(); }
    }
    static HttpContent Json(object value) => new StringContent(JsonSerializer.Serialize(value), Encoding.UTF8, "application/json");
    static string ConvertSpeech(byte[] wav, string folder, string name)
    {
        var raw = Path.Combine(folder, name + "-input.wav");
        var playable = Path.Combine(folder, name + ".wav");
        try
        {
            File.WriteAllBytes(raw, wav);
            var start = new ProcessStartInfo("ffmpeg") { UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = true };
            foreach (var arg in new[] { "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le", playable }) start.ArgumentList.Add(arg);
            using var process = Process.Start(start) ?? throw new Exception("Audio converter unavailable");
            if (!process.WaitForExit(10000)) { process.Kill(); throw new Exception("Audio conversion timed out"); }
            if (process.ExitCode != 0) throw new Exception("Audio conversion failed");
            return playable;
        }
        finally { File.Delete(raw); }
    }
    static void Handle(ChannelResource channel)
    {
        var callId = "VE" + Guid.NewGuid().ToString("N");
        var folder = Path.Combine(Path.GetTempPath(), callId);
        Directory.CreateDirectory(folder);
        if (!OperatingSystem.IsWindows()) File.SetUnixFileMode(folder, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
        var voice = channel.VoiceResource;
        var disconnected = false;
        channel.Disconnected += (_, _) => disconnected = true;
        var deadline = DateTime.UtcNow.AddMinutes(20);
        var path = "/voice-elements/step";
        var fields = new Dictionary<string, string> { ["CallSid"] = callId };
        var sequence = 0;
        var speechRecoveries = 0;
        var maxSpeechMs = 0;
        var scheduledDropSeconds = -1;
        var stage = "answer";
        var endReason = "loop-limit";
        var elapsed = Stopwatch.StartNew();
        bool Say(string text, bool interruptible = false)
        {
            // Split long answers to reduce peak WAV size and synthesis latency.
            while (text.Length > 0)
            {
                if (disconnected || DateTime.UtcNow >= deadline) return false;
                var length = Math.Min(text.Length, 900);
                if (length < text.Length)
                {
                    var boundary = text.LastIndexOf(' ', length - 1, length);
                    if (boundary > 450) length = boundary;
                }
                if (SayPart(text.Substring(0, length)) && interruptible) return true;
                text = text.Substring(length).TrimStart();
                if (disconnected) return false;
            }
            return false;
        }
        bool SayPart(string text)
        {
            stage = "speech-generate";
            byte[] wav;
            var synthesisWatch = Stopwatch.StartNew();
            try { wav = Post("/voice-elements/speech", Json(new { callId, text })); }
            catch (HttpRequestException error) { Console.Error.WriteLine($"CALL_SPEECH_HTTP_STATUS={(int?)error.StatusCode}"); throw new SpeechUnavailableException(); }
            catch (TaskCanceledException) { throw new SpeechUnavailableException(); }
            finally { maxSpeechMs = Math.Max(maxSpeechMs, (int)synthesisWatch.ElapsedMilliseconds); }
            stage = "speech-convert";
            var playable = ConvertSpeech(wav, folder, "tts-" + (++sequence));
            stage = "speech-play";
            try { voice.MaximumTime = 180; if (disconnected) return false; var result = voice.Play(playable); voice.ClearDigitBuffer = false; return VoiceInputPolicy.IsDigitInterruption(result); }
            finally { File.Delete(playable); }
        }
        try
        {
            channel.Answer();
            // Read-only diagnostics: never extend a provider/account time limit here.
            try
            {
                var remaining = (channel.DropTime - DateTime.UtcNow).TotalSeconds;
                scheduledDropSeconds = remaining > 0 && remaining < 86400 ? (int)remaining : -1;
                Console.WriteLine($"CALL_TIMER scheduled_drop_seconds={scheduledDropSeconds} app_limit_seconds=1200");
            }
            catch { Console.WriteLine("CALL_TIMER unavailable"); }
            voice.WipeDigitBuffer();
            voice.ClearDigitBuffer = false;
            for (var hop = 0; hop < 600 && !disconnected && DateTime.UtcNow < deadline; hop++)
            {
                stage = "workflow";
                var xml = Encoding.UTF8.GetString(Post(path, new FormUrlEncodedContent(fields)));
                fields = new Dictionary<string, string> { ["CallSid"] = callId };
                using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 100000 });
                var root = XDocument.Load(reader).Root ?? throw new Exception("Empty voice response");
                if (root.Name != "Response") throw new Exception("Invalid voice response");
                var next = false;
                try
                {
                foreach (var command in root.Elements())
                {
                    if (disconnected || DateTime.UtcNow >= deadline) { endReason = disconnected ? "remote-disconnect" : "duration-limit"; return; }
                    switch (command.Name.LocalName)
                    {
                        case "Say": voice.ClearDigitBuffer = false; voice.TerminationDigits = ""; Say(command.Value); break;
                        case "Pause": Thread.Sleep(Math.Clamp((int?)command.Attribute("length") ?? 1, 1, 5) * 1000); break;
                        case "Hangup": endReason = "workflow-hangup"; return;
                        case "Redirect": path = Target(command.Value.Trim()); next = true; break;
                        case "Gather":
                            var requestedDigits = Math.Clamp((int?)command.Attribute("numDigits") ?? 1, 1, 6);
                            var inputTimeout = Math.Clamp((int?)command.Attribute("timeout") ?? 12, 1, 60);
                            if ((string?)command.Attribute("clearDigits") == "true") voice.WipeDigitBuffer();
                            voice.ClearDigitBuffer = false;
                            voice.MaximumDigits = 1;
                            voice.TerminationDigits = "ANY";
                            foreach (var say in command.Elements("Say")) { if (Say(say.Value, true)) break; }
                            voice.ClearDigitBuffer = false;
                            voice.MaximumDigits = requestedDigits;
                            voice.TerminationDigits = (string?)command.Attribute("finishOnKey") ?? "#";
                            voice.MaximumTime = inputTimeout;
                            voice.InterDigitTimeout = VoiceInputPolicy.InterDigitSeconds(requestedDigits, inputTimeout);
                            voice.InterDigitTimeoutStartsAfterFirstDigit = true;
                            stage = "collect-digits";
                            voice.GetDigits();
                            var digits = voice.DigitBuffer;
                            voice.ClearDigitBuffer = false;
                            if (!string.IsNullOrEmpty(digits)) { fields["Digits"] = digits; path = Target((string?)command.Attribute("action") ?? "/voice/step"); next = true; }
                            break;
                        case "Record":
                            var action = (string?)command.Attribute("action") ?? throw new Exception("Recording callback missing");
                            var nonce = new Uri("http://localhost" + action).Query;
                            var filename = Path.Combine(folder, "recording.wav");
                            voice.ClearDigitBuffer = true;
                            voice.TerminationDigits = "#";
                            voice.MaximumTime = Math.Clamp((int?)command.Attribute("maxLength") ?? 180, 1, 180);
                            voice.MaximumSilence = Math.Clamp((int?)command.Attribute("timeout") ?? 5, 1, 20);
                            voice.PlayTone(1000, 100, 500);
                            stage = "record";
                            voice.Record(filename);
                            try
                            {
                                if (disconnected) return;
                                stage = "record-upload";
                                var audio = File.ReadAllBytes(filename);
                                if (audio.Length > 6 * 1024 * 1024) throw new Exception("Recording too large");
                                using var result = JsonDocument.Parse(Post("/voice-elements/record" + nonce + "&call=" + callId, new ByteArrayContent(audio)));
                                var reference = result.RootElement.GetProperty("recording").GetString()!;
                                fields["RecordingUrl"] = reference; fields["RecordingSid"] = reference;
                                path = Target(action); next = true;
                            }
                            finally { File.Delete(filename); }
                            break;
                        default: throw new Exception("Unsupported voice instruction");
                    }
                    if (next) break;
                }
                }
                catch (SpeechUnavailableException)
                {
                    if (disconnected || DateTime.UtcNow >= deadline || RecoveryAudio == null || ++speechRecoveries > 2) throw;
                    Console.WriteLine("CALL_SPEECH_RECOVERY: returning to workflow without replaying input or sending");
                    voice.ClearDigitBuffer = true;
                    voice.TerminationDigits = "";
                    voice.MaximumTime = 30;
                    voice.Play(RecoveryAudio);
                    voice.WipeDigitBuffer();
                    voice.ClearDigitBuffer = false;
                    Post("/voice-elements/speech-recover", Json(new { callId }));
                    path = "/voice-elements/step";
                    fields = new Dictionary<string, string> { ["CallSid"] = callId };
                    next = true;
                }
                if (!next) { endReason = "no-next-instruction"; return; }
            }
        }
        catch (Exception error)
        {
            endReason = "error";
            Console.Error.WriteLine($"CALL_ERROR stage={stage} type={error.GetType().FullName} hresult=0x{error.HResult:X8}");
            if (error is HttpRequestException http && http.StatusCode is { } status)
                Console.Error.WriteLine($"CALL_HTTP_STATUS={(int)status}");
            // Never include caller input, credentials, exception messages or recording paths.
        }
        finally
        {
            int? generalCause = null, gcCause = null, dropError = null;
            try { generalCause = Convert.ToInt32(channel.GeneralCause); gcCause = Convert.ToInt32(channel.GcCause); dropError = Convert.ToInt32(channel.DropError); }
            catch { Console.WriteLine("CALL_DISCONNECT codes_unavailable"); }
            var reason = disconnected ? "remote-disconnect" : DateTime.UtcNow >= deadline ? "duration-limit" : endReason;
            var durationSeconds = (int)elapsed.Elapsed.TotalSeconds;
            Console.WriteLine($"CALL_DISCONNECT general_cause={generalCause} gc_cause={gcCause} drop_error={dropError}");
            Console.WriteLine($"CALL_END reason={reason} stage={stage} seconds={durationSeconds}");
            try { Post("/voice-elements/end", Json(new { callId, diagnostics = new { durationSeconds, reason, stage, generalCause, gcCause, dropError, scheduledDropSeconds, maxSpeechMs } })); } catch { Console.WriteLine("CALL_END_CALLBACK_FAILED"); }
            Directory.Delete(folder, true);
        }
    }
}
