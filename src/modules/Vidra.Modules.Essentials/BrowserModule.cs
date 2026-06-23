using Microsoft.Maui.ApplicationModel;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public enum BrowserMode
{
    SystemPreferred,
    External
}

public record BrowserOpenArgs(string Url, BrowserMode? Mode);
public record BrowserOpenResult(bool Success);

/// <summary>
/// Opens URLs in the system browser via MAUI Essentials <see cref="Browser"/>.
/// </summary>
[BridgeModule("browser")]
public sealed class BrowserModule : BridgeModuleBase
{
    [BridgeMethod("open")]
    public async Task<BrowserOpenResult> OpenAsync(BrowserOpenArgs args, CancellationToken ct)
    {
        if (!Uri.TryCreate(args.Url, UriKind.Absolute, out var uri))
            throw new InvalidOperationException($"'{args.Url}' is not a valid absolute URL.");

        var launchMode = args.Mode == BrowserMode.External
            ? BrowserLaunchMode.External
            : BrowserLaunchMode.SystemPreferred;

        var opened = await Browser.Default.OpenAsync(uri, launchMode);
        return new BrowserOpenResult(opened);
    }
}
