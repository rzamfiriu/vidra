using Vidra.Bridge;

namespace Vidra.CodeGen.TestFixtures;

public enum Mood
{
    Happy,
    Neutral,
    Sad
}

public record EchoArgs(string Text, int? Count);

public record EchoResult(string Text, string[] Tags, Mood Mood, Mood[] Moods, string? Note);

/// <summary>
/// Fixture module used by the Vidra.CodeGen test suite.
/// Designed to exercise primitives, records, arrays, nullables, and enums
/// without drifting with the real production modules.
/// </summary>
[BridgeModule("sample")]
public sealed class SampleModule : BridgeModuleBase
{
    [BridgeMethod("echo")]
    public Task<EchoResult> EchoAsync(EchoArgs args, CancellationToken ct)
        => Task.FromResult(new EchoResult(args.Text, Array.Empty<string>(), Mood.Happy, new[] { Mood.Happy }, null));
}

[BridgeEventContract("sample")]
public interface ISampleEvents
{
    [BridgeEvent("changed")]
    void Changed(EchoResult payload);
}

[JsContract("dialog")]
public interface IDialogJs
{
    [JsMethod("confirm")]
    Task<bool> ConfirmAsync(EchoArgs payload);
}
