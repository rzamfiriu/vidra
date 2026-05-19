using Vidra.Bridge;

namespace Vidra.Modules.Clipboard;

public record GetTextResult(string Text);

public record SetTextArgs(string Text);
public record SetTextResult(bool Success);

public record HasTextResult(bool HasText);

[BridgeModule("clipboard")]
public sealed class ClipboardModule : BridgeModuleBase
{
    [BridgeMethod("getText")]
    public async Task<GetTextResult> GetTextAsync(CancellationToken ct)
    {
        var text = await Microsoft.Maui.ApplicationModel.DataTransfer.Clipboard.Default.GetTextAsync();
        return new GetTextResult(text ?? "");
    }

    [BridgeMethod("setText")]
    public async Task<SetTextResult> SetTextAsync(SetTextArgs args, CancellationToken ct)
    {
        await Microsoft.Maui.ApplicationModel.DataTransfer.Clipboard.Default.SetTextAsync(args.Text);
        return new SetTextResult(true);
    }

    [BridgeMethod("hasText")]
    public Task<HasTextResult> HasTextAsync(CancellationToken ct)
    {
        var has = Microsoft.Maui.ApplicationModel.DataTransfer.Clipboard.Default.HasText;
        return Task.FromResult(new HasTextResult(has));
    }
}
