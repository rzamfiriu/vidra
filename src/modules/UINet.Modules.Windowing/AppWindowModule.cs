using UINet.Bridge;

namespace UINet.Modules.Windowing;

public interface IAppWindowService
{
    void AttachCallbackChannel(IJsCallbackChannel callbackChannel);
    void TrackPage(Page page);
    Task<WindowSupport> GetSupportAsync(CancellationToken ct);
    Task<WindowInfo> GetCurrentAsync(CancellationToken ct);
    Task<WindowInfo> ConfigureAsync(ConfigureWindowArgs args, CancellationToken ct);
    Task<WindowInfo> SetTitleAsync(string title, CancellationToken ct);
    Task<WindowInfo> SetSizeAsync(double width, double height, CancellationToken ct);
    Task<WindowInfo> CenterAsync(CancellationToken ct);
    Task<WindowInfo> MaximizeAsync(CancellationToken ct);
    Task<WindowInfo> MinimizeAsync(CancellationToken ct);
    Task<WindowInfo> RestoreAsync(CancellationToken ct);
    Task<WindowInfo> SetFullscreenAsync(bool enabled, CancellationToken ct);
}

[BridgeModule("appWindow")]
public sealed class AppWindowModule : BridgeModuleBase
{
    private readonly IAppWindowService _windowService;

    public AppWindowModule(IAppWindowService windowService)
    {
        _windowService = windowService;
    }

    [BridgeMethod("getSupport")]
    public Task<WindowSupport> GetSupportAsync(CancellationToken ct)
    {
        return _windowService.GetSupportAsync(ct);
    }

    [BridgeMethod("getCurrent")]
    public Task<WindowInfo> GetCurrentAsync(CancellationToken ct)
    {
        return _windowService.GetCurrentAsync(ct);
    }

    [BridgeMethod("configure")]
    public Task<WindowInfo> ConfigureAsync(ConfigureWindowArgs args, CancellationToken ct)
    {
        DimensionValidation.ValidateOptionalDimension(args.Width, nameof(args.Width));
        DimensionValidation.ValidateOptionalDimension(args.Height, nameof(args.Height));
        return _windowService.ConfigureAsync(args, ct);
    }

    [BridgeMethod("setTitle")]
    public Task<WindowInfo> SetTitleAsync(SetTitleArgs args, CancellationToken ct)
    {
        return _windowService.SetTitleAsync(args.Title ?? string.Empty, ct);
    }

    [BridgeMethod("setSize")]
    public Task<WindowInfo> SetSizeAsync(SetSizeArgs args, CancellationToken ct)
    {
        DimensionValidation.ValidateDimension(args.Width, nameof(args.Width));
        DimensionValidation.ValidateDimension(args.Height, nameof(args.Height));
        return _windowService.SetSizeAsync(args.Width, args.Height, ct);
    }

    [BridgeMethod("center")]
    public Task<WindowInfo> CenterAsync(CancellationToken ct)
    {
        return _windowService.CenterAsync(ct);
    }

    [BridgeMethod("maximize")]
    public Task<WindowInfo> MaximizeAsync(CancellationToken ct)
    {
        return _windowService.MaximizeAsync(ct);
    }

    [BridgeMethod("minimize")]
    public Task<WindowInfo> MinimizeAsync(CancellationToken ct)
    {
        return _windowService.MinimizeAsync(ct);
    }

    [BridgeMethod("restore")]
    public Task<WindowInfo> RestoreAsync(CancellationToken ct)
    {
        return _windowService.RestoreAsync(ct);
    }

    [BridgeMethod("setFullscreen")]
    public Task<WindowInfo> SetFullscreenAsync(SetFullscreenArgs args, CancellationToken ct)
    {
        return _windowService.SetFullscreenAsync(args.Enabled, ct);
    }
}
