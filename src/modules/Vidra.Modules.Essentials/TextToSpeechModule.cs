using Microsoft.Maui.Media;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public record SpeakArgs(string Text, float? Pitch, float? Volume);
public record SpeakResult(bool Success);

/// <summary>
/// Speaks text aloud via MAUI Essentials <see cref="TextToSpeech"/>.
/// The call resolves once the utterance finishes (or is cancelled).
/// </summary>
[BridgeModule("textToSpeech")]
public sealed class TextToSpeechModule : BridgeModuleBase
{
    [BridgeMethod("speak")]
    public async Task<SpeakResult> SpeakAsync(SpeakArgs args, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(args.Text))
            throw new InvalidOperationException("Text is required to speak.");

        var options = args.Pitch is not null || args.Volume is not null
            ? new SpeechOptions { Pitch = args.Pitch, Volume = args.Volume }
            : null;

        await TextToSpeech.Default.SpeakAsync(args.Text, options, ct);
        return new SpeakResult(true);
    }
}
