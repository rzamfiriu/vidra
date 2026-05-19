using Vidra.Bridge;
using Vidra.Modules.Windowing;

namespace Vidra.Modules.Windowing.Tests;

/// <summary>
/// A portable clone of <c>AppWindowModule</c> (sans MAUI <c>Page</c> reference)
/// that exercises the exact same validation helpers and bridge attribute shape.
/// It's structurally identical to the production module so that a regression on
/// names, method lists, or validation still fails this test suite.
/// </summary>
public interface ITestAppWindowService
{
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
public sealed class TestAppWindowModule : BridgeModuleBase
{
    private readonly ITestAppWindowService _windowService;

    public TestAppWindowModule(ITestAppWindowService windowService)
    {
        _windowService = windowService;
    }

    [BridgeMethod("getSupport")]
    public Task<WindowSupport> GetSupportAsync(CancellationToken ct)
        => _windowService.GetSupportAsync(ct);

    [BridgeMethod("getCurrent")]
    public Task<WindowInfo> GetCurrentAsync(CancellationToken ct)
        => _windowService.GetCurrentAsync(ct);

    [BridgeMethod("configure")]
    public Task<WindowInfo> ConfigureAsync(ConfigureWindowArgs args, CancellationToken ct)
    {
        DimensionValidation.ValidateOptionalDimension(args.Width, nameof(args.Width));
        DimensionValidation.ValidateOptionalDimension(args.Height, nameof(args.Height));
        return _windowService.ConfigureAsync(args, ct);
    }

    [BridgeMethod("setTitle")]
    public Task<WindowInfo> SetTitleAsync(SetTitleArgs args, CancellationToken ct)
        => _windowService.SetTitleAsync(args.Title ?? string.Empty, ct);

    [BridgeMethod("setSize")]
    public Task<WindowInfo> SetSizeAsync(SetSizeArgs args, CancellationToken ct)
    {
        DimensionValidation.ValidateDimension(args.Width, nameof(args.Width));
        DimensionValidation.ValidateDimension(args.Height, nameof(args.Height));
        return _windowService.SetSizeAsync(args.Width, args.Height, ct);
    }

    [BridgeMethod("center")]
    public Task<WindowInfo> CenterAsync(CancellationToken ct)
        => _windowService.CenterAsync(ct);

    [BridgeMethod("maximize")]
    public Task<WindowInfo> MaximizeAsync(CancellationToken ct)
        => _windowService.MaximizeAsync(ct);

    [BridgeMethod("minimize")]
    public Task<WindowInfo> MinimizeAsync(CancellationToken ct)
        => _windowService.MinimizeAsync(ct);

    [BridgeMethod("restore")]
    public Task<WindowInfo> RestoreAsync(CancellationToken ct)
        => _windowService.RestoreAsync(ct);

    [BridgeMethod("setFullscreen")]
    public Task<WindowInfo> SetFullscreenAsync(SetFullscreenArgs args, CancellationToken ct)
        => _windowService.SetFullscreenAsync(args.Enabled, ct);
}

public sealed class FakeAppWindowService : ITestAppWindowService
{
    public WindowInfo Current { get; set; } =
        new("test", 800, 600, WindowState.Restored);

    public WindowSupport Support { get; set; } =
        new("test", true, true, true, true, true, true, true, true, true);

    public Task<WindowSupport> GetSupportAsync(CancellationToken ct) => Task.FromResult(Support);
    public Task<WindowInfo> GetCurrentAsync(CancellationToken ct) => Task.FromResult(Current);
    public Task<WindowInfo> ConfigureAsync(ConfigureWindowArgs args, CancellationToken ct)
    {
        Current = Current with
        {
            Title = args.Title ?? Current.Title,
            Width = args.Width ?? Current.Width,
            Height = args.Height ?? Current.Height,
        };
        return Task.FromResult(Current);
    }
    public Task<WindowInfo> SetTitleAsync(string title, CancellationToken ct)
    {
        Current = Current with { Title = title };
        return Task.FromResult(Current);
    }
    public Task<WindowInfo> SetSizeAsync(double width, double height, CancellationToken ct)
    {
        Current = Current with { Width = width, Height = height };
        return Task.FromResult(Current);
    }
    public Task<WindowInfo> CenterAsync(CancellationToken ct) => Task.FromResult(Current);
    public Task<WindowInfo> MaximizeAsync(CancellationToken ct)
    {
        Current = Current with { State = WindowState.Maximized };
        return Task.FromResult(Current);
    }
    public Task<WindowInfo> MinimizeAsync(CancellationToken ct)
    {
        Current = Current with { State = WindowState.Minimized };
        return Task.FromResult(Current);
    }
    public Task<WindowInfo> RestoreAsync(CancellationToken ct)
    {
        Current = Current with { State = WindowState.Restored };
        return Task.FromResult(Current);
    }
    public Task<WindowInfo> SetFullscreenAsync(bool enabled, CancellationToken ct)
    {
        Current = Current with { State = enabled ? WindowState.Fullscreen : WindowState.Restored };
        return Task.FromResult(Current);
    }
}
