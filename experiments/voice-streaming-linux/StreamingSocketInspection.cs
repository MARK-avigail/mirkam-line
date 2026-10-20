using System.Reflection;
using System.Reflection.Emit;
using VoiceElements.Client.Streams;

// Metadata only: inspect socket dependencies without loading any account data.
internal static class StreamingSocketInspection
{
    internal static int Run()
    {
        var codes = typeof(OpCodes).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.FieldType == typeof(OpCode)).Select(f => (OpCode)f.GetValue(null)!)
            .ToDictionary(op => unchecked((ushort)op.Value));
        var assembly = typeof(MediaProcessor).Assembly;
        foreach (var type in assembly.GetTypes().Where(t => t.Name is "UdpPort" or "UdpPool" or "Transport"))
        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly).Cast<MethodBase>().Concat(type.GetConstructors(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static)))
        {
            var il = method.GetMethodBody()?.GetILAsByteArray();
            if (il == null) continue;
            int index = 0;
            while (index < il.Length)
            {
                ushort opKey = il[index++];
                if (opKey == 0xfe) opKey = (ushort)(0xfe00 | il[index++]);
                if (!codes.TryGetValue(opKey, out var code)) throw new Exception("Unknown opcode");
                int size = code.OperandType switch
                {
                    OperandType.InlineNone => 0,
                    OperandType.ShortInlineBrTarget or OperandType.ShortInlineI or OperandType.ShortInlineVar => 1,
                    OperandType.InlineVar => 2,
                    OperandType.InlineI8 or OperandType.InlineR => 8,
                    OperandType.InlineSwitch => 4 + 4 * BitConverter.ToInt32(il, index),
                    _ => 4
                };
                if (code.OperandType == OperandType.InlineMethod)
                {
                    var called = method.Module.ResolveMethod(BitConverter.ToInt32(il, index));
                    Console.WriteLine($"STREAMING_SOCKET_CALL {type.Name}.{method.Name} -> {called?.DeclaringType?.FullName}.{called}");
                }
                index += size;
            }
        }
        Console.WriteLine("STREAMING_SOCKET_METADATA_ONLY: no media initialized");
        return 0;
    }
}
