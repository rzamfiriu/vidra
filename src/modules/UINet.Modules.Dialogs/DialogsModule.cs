using UINet.Bridge;

namespace UINet.Modules.Dialogs;

public record AlertArgs(string Title, string Message, string? Ok);
public record AlertResult(bool Dismissed);

public record ConfirmArgs(string Title, string Message, string? Accept, string? Cancel);
public record ConfirmResult(bool Confirmed);

public record PromptArgs(string Title, string? Message, string? Accept, string? Cancel);
public record PromptResult(string? Value);

[BridgeModule("dialogs")]
public sealed class DialogsModule : BridgeModuleBase
{
    [BridgeMethod("alert")]
    public async Task<AlertResult> AlertAsync(AlertArgs args, CancellationToken ct)
    {
        var page = Application.Current?.Windows.FirstOrDefault()?.Page
            ?? throw new InvalidOperationException("No active page.");
        await page.DisplayAlert(args.Title, args.Message, args.Ok ?? "OK");
        return new AlertResult(true);
    }

    [BridgeMethod("confirm")]
    public async Task<ConfirmResult> ConfirmAsync(ConfirmArgs args, CancellationToken ct)
    {
        var page = Application.Current?.Windows.FirstOrDefault()?.Page
            ?? throw new InvalidOperationException("No active page.");
        var result = await page.DisplayAlert(args.Title, args.Message, args.Accept ?? "Yes", args.Cancel ?? "No");
        return new ConfirmResult(result);
    }

    [BridgeMethod("prompt")]
    public async Task<PromptResult> PromptAsync(PromptArgs args, CancellationToken ct)
    {
        var page = Application.Current?.Windows.FirstOrDefault()?.Page
            ?? throw new InvalidOperationException("No active page.");
        var result = await page.DisplayPromptAsync(args.Title, args.Message ?? "", args.Accept ?? "OK", args.Cancel ?? "Cancel");
        return new PromptResult(result);
    }
}
