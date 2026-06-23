using Microsoft.Maui.ApplicationModel;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public record LauncherOpenArgs(string Uri);
public record LauncherOpenResult(bool Success);

public record LauncherCanOpenArgs(string Uri);
public record LauncherCanOpenResult(bool CanOpen);

/// <summary>
/// Opens URIs in their default registered handler (mailto:, tel:, custom
/// schemes, files) via MAUI Essentials <see cref="Launcher"/>.
/// </summary>
[BridgeModule("launcher")]
public sealed class LauncherModule : BridgeModuleBase
{
    [BridgeMethod("open")]
    public async Task<LauncherOpenResult> OpenAsync(LauncherOpenArgs args, CancellationToken ct)
    {
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri))
            throw new InvalidOperationException($"'{args.Uri}' is not a valid absolute URI.");

        var opened = await Launcher.Default.TryOpenAsync(uri);
        return new LauncherOpenResult(opened);
    }

    [BridgeMethod("canOpen")]
    public async Task<LauncherCanOpenResult> CanOpenAsync(LauncherCanOpenArgs args, CancellationToken ct)
    {
        if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri))
            return new LauncherCanOpenResult(false);

        var canOpen = await Launcher.Default.CanOpenAsync(uri);
        return new LauncherCanOpenResult(canOpen);
    }
}
