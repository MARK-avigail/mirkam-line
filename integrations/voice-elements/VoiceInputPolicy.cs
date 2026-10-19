using VoiceElements.Common;

internal static class VoiceInputPolicy
{
    // SDK termination codes are flags: Digit may be combined with EndOfData.
    internal static bool IsDigitInterruption(TerminationCode code) =>
        code != TerminationCode.OtherError &&
        (code & (TerminationCode.Hangup | TerminationCode.Error)) == 0 &&
        (code & (TerminationCode.Digit | TerminationCode.MaximumDTMF)) != 0;

    // A pause between PIN digits must not inherit the SDK's shorter default.
    internal static int InterDigitSeconds(int digits, int totalSeconds) =>
        digits > 1 ? Math.Clamp(totalSeconds, 1, 60) : Math.Clamp(totalSeconds, 1, 12);

    internal static int SelfTest()
    {
        var cases = new[] {
            (TerminationCode.Normal, false), (TerminationCode.EndOfData, false),
            (TerminationCode.Digit, true), (TerminationCode.MaximumDTMF, true),
            (TerminationCode.Digit | TerminationCode.MaximumDTMF, true),
            (TerminationCode.Digit | TerminationCode.EndOfData, true),
            (TerminationCode.Digit | TerminationCode.Hangup, false),
            (TerminationCode.Digit | TerminationCode.Error, false),
            (TerminationCode.OtherError, false), (TerminationCode.MaximumTime, false)
        };
        foreach (var (code, expected) in cases)
            if (IsDigitInterruption(code) != expected) throw new Exception("Digit termination policy failed");
        if (InterDigitSeconds(6, 30) != 30 || InterDigitSeconds(1, 60) != 12 || InterDigitSeconds(6, 120) != 60)
            throw new Exception("Digit timeout policy failed");
        Console.WriteLine("VOICE_INPUT_POLICY_OK: 13 checks; no provider connection or call attempted");
        return 0;
    }
}
