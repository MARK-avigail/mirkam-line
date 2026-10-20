using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using VoiceElements.Client.Streams;

// Experimental CLI only. Never enabled from environment or on a real call.
internal static class StreamingLoopbackProbe
{
    internal static int Run(string compatibilityLibrary)
    {
        if (!OperatingSystem.IsLinux()) throw new Exception("Linux probe required");
        var library = NativeLibrary.Load(Path.GetFullPath(compatibilityLibrary));
        NativeLibrary.SetDllImportResolver(typeof(MediaProcessor).Assembly, (name, _, _) =>
            name.Equals("Kernel32.dll", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("Kernel32", StringComparison.OrdinalIgnoreCase) ||
            name.Equals("winmm.dll", StringComparison.OrdinalIgnoreCase) ? library : IntPtr.Zero);
        // Use only loopback and a free local port; no settings or credentials read.
        using var reserve = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
        int port = ((IPEndPoint)reserve.Client.LocalEndPoint!).Port;
        reserve.Close();
        MediaProcessor? media = null;
        try
        {
            MediaProcessor.Init("127.0.0.1", "127.0.0.1", 1, port);
            media = new MediaProcessor(10, MediaProcessorCodec.G711_Mulaw_8Bit_8Khz);
            var received = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
            media.StreamEvent += (_, e) => received.TrySetResult(e.Buffer.ToArray());
            Console.WriteLine("STREAMING_LOCAL_INIT_OK: no provider connection");
            using var udp = new UdpClient(new IPEndPoint(IPAddress.Loopback, 0));
            var packet = new byte[172];
            packet[0] = 0x80; packet[1] = 0; // RTP v2 / PCMU, fixed local fixture.
            packet[11] = 1;
            Array.Fill(packet, (byte)0xff, 12, 160);
            var endpoint = new IPEndPoint(IPAddress.Loopback, media.GetPort());
            for (int i = 0; i < 20 && !received.Task.IsCompleted; i++)
            {
                packet[3] = (byte)i;
                packet[6] = (byte)((i * 160) >> 8); packet[7] = (byte)(i * 160);
                udp.Send(packet, packet.Length, endpoint);
                Thread.Sleep(20);
            }
            if (!received.Task.Wait(1500))
            {
                Console.WriteLine("STREAMING_LOCAL_AUDIO_NOT_CONFIRMED: initialization alone is insufficient");
                return 2;
            }
            if (received.Task.Result.Length == 0) throw new Exception("Empty local audio event");
            Console.WriteLine("STREAMING_LOCAL_AUDIO_RECEIVED: local synthetic packets only; not a telephone or GPT-Live test");
            return 0;
        }
        catch (Exception error)
        {
            var cause = error is TargetInvocationException ? error.InnerException! : error;
            Console.WriteLine("STREAMING_LOCAL_PROBE_FAILED type=" + cause.GetType().FullName);
            foreach (var frame in (new System.Diagnostics.StackTrace(cause, false).GetFrames() ?? Array.Empty<System.Diagnostics.StackFrame>()).Take(6))
                Console.WriteLine("PROBE_FRAME=" + frame.GetMethod()?.DeclaringType?.FullName + "." + frame.GetMethod()?.Name);
            return 1;
        }
        finally
        {
            try { media?.Dispose(); } catch { }
            // Stop is global in this SDK; reflect only to avoid assuming staticness.
            try { var stop = typeof(MediaProcessor).GetMethod("Stop"); if (stop?.IsStatic == true) stop.Invoke(null, null); } catch { }
        }
    }
}
