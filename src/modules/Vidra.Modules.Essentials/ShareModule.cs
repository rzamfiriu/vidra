using Microsoft.Maui.ApplicationModel.DataTransfer;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public record ShareTextArgs(string Text, string? Title, string? Subject, string? Uri);
public record ShareResult(bool Success);

/// <summary>
/// Invokes the OS share sheet via MAUI Essentials <see cref="Share"/>.
/// On desktop this surfaces the macOS share menu / Windows share UI.
/// </summary>
[BridgeModule("share")]
public sealed class ShareModule : BridgeModuleBase
{
    [BridgeMethod("shareText")]
    public async Task<ShareResult> ShareTextAsync(ShareTextArgs args, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(args.Text) && string.IsNullOrEmpty(args.Uri))
            throw new InvalidOperationException("Either text or uri is required to share.");

        await Share.Default.RequestAsync(new ShareTextRequest
        {
            Text = args.Text,
            Title = args.Title,
            Subject = args.Subject,
            Uri = args.Uri,
        });

        return new ShareResult(true);
    }
}
