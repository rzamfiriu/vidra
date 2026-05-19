using System.Diagnostics;
using Vidra.Bridge;
using Vidra.Modules.Windowing;

namespace Vidra.Hosting;

public sealed partial class AppWindowService : IAppWindowService
{
    private Window? _trackedWindow;
    private IJsCallbackChannel? _callbackChannel;
    private WindowState _lastKnownState = WindowState.Restored;
    private WindowState _lastEmittedState = WindowState.Restored;

    public void AttachCallbackChannel(IJsCallbackChannel callbackChannel)
    {
        _callbackChannel = callbackChannel;
    }

    public void TrackPage(Page page)
    {
        if (MainThread.IsMainThread)
        {
            TrackWindow(page.Window ?? Application.Current?.Windows.FirstOrDefault());
            return;
        }

        MainThread.BeginInvokeOnMainThread(() =>
        {
            TrackWindow(page.Window ?? Application.Current?.Windows.FirstOrDefault());
        });
    }

    public Task<WindowSupport> GetSupportAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        return MainThread.InvokeOnMainThreadAsync(BuildSupportSnapshot);
    }

    public Task<WindowInfo> GetCurrentAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        return MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();
            return SnapshotWindow(window);
        });
    }

    public Task<WindowInfo> ConfigureAsync(ConfigureWindowArgs args, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        return MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();

            if (args.Title is not null)
                window.Title = args.Title;

            if (args.Width.HasValue || args.Height.HasValue)
            {
                var width = args.Width ?? NormalizeDimension(window.Width, window.Page?.Width ?? 0);
                var height = args.Height ?? NormalizeDimension(window.Height, window.Page?.Height ?? 0);
                window.Width = width;
                window.Height = height;
            }

            return SnapshotWindow(window);
        });
    }

    public Task<WindowInfo> SetTitleAsync(string title, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        return MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();
            window.Title = title;
            return SnapshotWindow(window);
        });
    }

    public Task<WindowInfo> SetSizeAsync(double width, double height, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        return MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();
            window.Width = width;
            window.Height = height;
            return SnapshotWindow(window);
        });
    }

    public Task<WindowInfo> CenterAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        return MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();
            CenterPlatformWindow(window);
            return SnapshotWindow(window);
        });
    }

    public async Task<WindowInfo> MaximizeAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var info = await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();
            _lastKnownState = WindowState.Maximized;
            MaximizePlatformWindow(window);
            return SnapshotWindow(window);
        });

        await EmitProgrammaticStateChangeAsync(info, ct);
        return info;
    }

    public async Task<WindowInfo> MinimizeAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var info = await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();
            _lastKnownState = WindowState.Minimized;
            MinimizePlatformWindow(window);
            return SnapshotWindow(window);
        });

        await EmitProgrammaticStateChangeAsync(info, ct);
        return info;
    }

    public async Task<WindowInfo> RestoreAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var info = await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();
            _lastKnownState = WindowState.Restored;
            RestorePlatformWindow(window);
            return SnapshotWindow(window);
        });

        await EmitProgrammaticStateChangeAsync(info, ct);
        return info;
    }

    public async Task<WindowInfo> SetFullscreenAsync(bool enabled, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();

        var info = await MainThread.InvokeOnMainThreadAsync(() =>
        {
            var window = GetTrackedWindow();
            _lastKnownState = enabled ? WindowState.Fullscreen : WindowState.Restored;
            SetFullscreenPlatformWindow(window, enabled);
            return SnapshotWindow(window);
        });

        await EmitProgrammaticStateChangeAsync(info, ct);
        return info;
    }

    private Window GetTrackedWindow()
    {
        TrackWindow(_trackedWindow ?? Application.Current?.Windows.FirstOrDefault());
        return _trackedWindow ?? throw new InvalidOperationException("No active window.");
    }

    private void TrackWindow(Window? window)
    {
        if (window is null)
            return;

        if (ReferenceEquals(_trackedWindow, window))
            return;

        UntrackWindow();
        _trackedWindow = window;

        SubscribeWindowEvents(window);
        AttachPlatformHooks(window);

        var snapshot = SnapshotWindow(window);
        _lastKnownState = snapshot.State;
        _lastEmittedState = snapshot.State;
    }

    private void UntrackWindow()
    {
        if (_trackedWindow is not null)
            UnsubscribeWindowEvents(_trackedWindow);

        DetachPlatformHooks();
        _trackedWindow = null;
    }

    private async void OnTrackedWindowSizeChanged(object? sender, EventArgs e)
    {
        if (sender is not Window window)
            return;

        try
        {
            var info = SnapshotWindow(window);
            await EmitEventAsync(AppWindowEvents.Resized, info);
            await EmitStateChangedIfNeededAsync(info);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Vidra.AppWindow] Failed to handle size change: {ex.Message}");
        }
    }

    private WindowInfo SnapshotWindow(Window window)
    {
        var title = window.Title ?? string.Empty;
        var width = NormalizeDimension(window.Width, window.Page?.Width ?? 0);
        var height = NormalizeDimension(window.Height, window.Page?.Height ?? 0);
        var state = DetectWindowState(window);

        _lastKnownState = state;
        return new WindowInfo(title, width, height, state);
    }

    private static double NormalizeDimension(double value, double fallback)
    {
        if (double.IsNaN(value) || double.IsInfinity(value) || value <= 0)
            return fallback > 0 ? fallback : 0;

        return value;
    }

    private Task EmitProgrammaticStateChangeAsync(WindowInfo info, CancellationToken ct)
    {
        return EmitProgrammaticStateChangeAsyncCore(info, ct);
    }

    private async Task EmitStateChangedIfNeededAsync(WindowInfo info, bool force = false, CancellationToken ct = default)
    {
        if (!force && info.State == _lastEmittedState)
            return;

        _lastEmittedState = info.State;
        await EmitEventAsync(AppWindowEvents.StateChanged, info, ct);
    }

    private async Task EmitEventAsync(string eventName, WindowInfo info, CancellationToken ct = default)
    {
        if (_callbackChannel is null)
            return;

        await _callbackChannel.SendEventAsync(new BridgeEvent
        {
            Event = eventName,
            Data = info
        }, ct);
    }

    private WindowState DetectWindowState(Window window)
    {
        return DetectWindowStateCore(window);
    }

    private void CenterPlatformWindow(Window window)
    {
        CenterPlatformWindowCore(window);
    }

    private void MaximizePlatformWindow(Window window)
    {
        MaximizePlatformWindowCore(window);
    }

    private void MinimizePlatformWindow(Window window)
    {
        MinimizePlatformWindowCore(window);
    }

    private void RestorePlatformWindow(Window window)
    {
        RestorePlatformWindowCore(window);
    }

    private void SetFullscreenPlatformWindow(Window window, bool enabled)
    {
        SetFullscreenPlatformWindowCore(window, enabled);
    }

    private static partial WindowSupport BuildSupportSnapshot();
    private partial void SubscribeWindowEvents(Window window);
    private partial void UnsubscribeWindowEvents(Window window);
    private partial Task EmitProgrammaticStateChangeAsyncCore(WindowInfo info, CancellationToken ct);
    private partial WindowState DetectWindowStateCore(Window window);
    private partial void CenterPlatformWindowCore(Window window);
    private partial void MaximizePlatformWindowCore(Window window);
    private partial void MinimizePlatformWindowCore(Window window);
    private partial void RestorePlatformWindowCore(Window window);
    private partial void SetFullscreenPlatformWindowCore(Window window, bool enabled);
    private partial void AttachPlatformHooks(Window window);
    private partial void DetachPlatformHooks();
}
