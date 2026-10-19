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
    static readonly SemaphoreSlim Slots = new(2, 2);
    static readonly ManualResetEventSlim Stop = new(false);
    static string Required(string key) => Environment.GetEnvironmentVariable(key) is { Length: > 0 } v ? v : throw new Exception("Missing setting: " + key);
    static int Main()
    {
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
        void Say(string text)
        {
            var wav = Post("/voice-elements/speech", Json(new { callId, text }));
            var raw = Path.Combine(folder, "tts-input.wav");
            var playable = Path.Combine(folder, "tts-" + (++sequence) + ".wav");
            File.WriteAllBytes(raw, wav);
            var start = new ProcessStartInfo("ffmpeg") { UseShellExecute = false, RedirectStandardError = true, RedirectStandardOutput = true };
            foreach (var arg in new[] { "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", raw, "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le", playable }) start.ArgumentList.Add(arg);
            using var process = Process.Start(start) ?? throw new Exception("Audio converter unavailable");
            if (!process.WaitForExit(10000)) { process.Kill(); throw new Exception("Audio conversion timed out"); }
            if (process.ExitCode != 0) throw new Exception("Audio conversion failed");
            try { voice.MaximumTime = 180; if (!disconnected) voice.Play(playable); }
            finally { File.Delete(raw); File.Delete(playable); }
        }
        try
        {
            channel.Answer();
            for (var hop = 0; hop < 600 && !disconnected && DateTime.UtcNow < deadline; hop++)
            {
                var xml = Encoding.UTF8.GetString(Post(path, new FormUrlEncodedContent(fields)));
                fields = new Dictionary<string, string> { ["CallSid"] = callId };
                using var reader = XmlReader.Create(new StringReader(xml), new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 100000 });
                var root = XDocument.Load(reader).Root ?? throw new Exception("Empty voice response");
                if (root.Name != "Response") throw new Exception("Invalid voice response");
                var next = false;
                foreach (var command in root.Elements())
                {
                    if (disconnected || DateTime.UtcNow >= deadline) return;
                    switch (command.Name.LocalName)
                    {
                        case "Say": voice.ClearDigitBuffer = true; Say(command.Value); break;
                        case "Pause": Thread.Sleep(Math.Clamp((int?)command.Attribute("length") ?? 1, 1, 5) * 1000); break;
                        case "Hangup": return;
                        case "Redirect": path = Target(command.Value.Trim()); next = true; break;
                        case "Gather":
                            voice.MaximumDigits = Math.Clamp((int?)command.Attribute("numDigits") ?? 1, 1, 6);
                            var inputTimeout = Math.Clamp((int?)command.Attribute("timeout") ?? 12, 1, 60);
                            voice.TerminationDigits = (string?)command.Attribute("finishOnKey") ?? "#";
                            voice.ClearDigitBuffer = true;
                            foreach (var say in command.Elements("Say")) { Say(say.Value); voice.ClearDigitBuffer = false; }
                            voice.ClearDigitBuffer = false;
                            voice.MaximumTime = inputTimeout;
                            voice.GetDigits();
                            var digits = voice.DigitBuffer;
                            voice.ClearDigitBuffer = true;
                            if (!string.IsNullOrEmpty(digits)) { fields["Digits"] = digits; path = Target((string?)command.Attribute("action") ?? "/voice/step"); next = true; }
                            break;
                        case "Record":
                            var action = (string?)command.Attribute("action") ?? throw new Exception("Recording callback missing");
                            var nonce = new Uri("http://localhost" + action).Query;
                            var filename = Path.Combine(folder, "recording.wav");
                            voice.ClearDigitBuffer = true;
                            voice.TerminationDigits = "#";
                            voice.MaximumTime = Math.Clamp((int?)command.Attribute("maxLength") ?? 180, 1, 180);
                            voice.PlayTone(1000, 100, 500);
                            voice.Record(filename);
                            try
                            {
                                if (disconnected) return;
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
                if (!next) return;
            }
        }
        finally { try { Post("/voice-elements/end", Json(new { callId })); } catch { Console.WriteLine("CALL_END_CALLBACK_FAILED"); } Directory.Delete(folder, true); }
    }
}
