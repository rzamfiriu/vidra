#if WINDOWS
using System.Diagnostics;
using Microsoft.UI.Windowing;
using Vidra.Modules.Windowing;
using Windows.Graphics;
using WinRT.Interop;

namespace Vidra.Hosting;

public sealed partial class AppWindowService
{
    private AppWindow? _windowsAppWindow;

    private static partial WindowSupport BuildSupportSnapshot()
    {
        return new WindowSupport(
            Platform: "windows",
            GetCurrent: true,
            Configure: true,
            SetTitle: true,
            SetSize: true,
            Center: true,
            Maximize: true,
            Minimize: true,
            Restore: true,
            SetFullscreen: true
        );
    }

    private partial void SubscribeWindowEvents(Window window)
    {
    }

    private partial void UnsubscribeWindowEvents(Window window)
    {
    }

    private partial Task EmitProgrammaticStateChangeAsyncCore(WindowInfo info, CancellationToken ct)
    {
        return Task.CompletedTask;
    }

    private partial WindowState DetectWindowStateCore(Window window)
    {
        return DetectWindowsWindowState(window);
    }

    private partial void CenterPlatformWindowCore(Window window)
    {
        var appWindow = GetWindowsAppWindow(window)
            ?? throw new InvalidOperationException("No native Windows app window is available.");

        var displayArea = DisplayArea.GetFromWindowId(appWindow.Id, DisplayAreaFallback.Nearest)
            ?? throw new InvalidOperationException("No display area is available for the window.");

        var x = displayArea.WorkArea.X + Math.Max(0, (displayArea.WorkArea.Width - appWindow.Size.Width) / 2);
        var y = displayArea.WorkArea.Y + Math.Max(0, (displayArea.WorkArea.Height - appWindow.Size.Height) / 2);

        appWindow.Move(new PointInt32(x, y));
    }

    private partial void MaximizePlatformWindowCore(Window window)
    {
        var presenter = GetWindowsOverlappedPresenter(window, ensureOverlapped: true);
        presenter.Maximize();
    }

    private partial void MinimizePlatformWindowCore(Window window)
    {
        var presenter = GetWindowsOverlappedPresenter(window, ensureOverlapped: true);
        presenter.Minimize();
    }

    private partial void RestorePlatformWindowCore(Window window)
    {
        var appWindow = GetWindowsAppWindow(window)
            ?? throw new InvalidOperationException("No native Windows app window is available.");

        if (appWindow.Presenter.Kind == AppWindowPresenterKind.FullScreen)
            appWindow.SetPresenter(AppWindowPresenterKind.Default);

        var presenter = GetWindowsOverlappedPresenter(window, ensureOverlapped: true);
        presenter.Restore();
    }

    private partial void SetFullscreenPlatformWindowCore(Window window, bool enabled)
    {
        var appWindow = GetWindowsAppWindow(window)
            ?? throw new InvalidOperationException("No native Windows app window is available.");

        if (enabled)
        {
            if (appWindow.Presenter.Kind != AppWindowPresenterKind.FullScreen)
                appWindow.SetPresenter(AppWindowPresenterKind.FullScreen);
        }
        else if (appWindow.Presenter.Kind == AppWindowPresenterKind.FullScreen)
        {
            appWindow.SetPresenter(AppWindowPresenterKind.Default);
        }
    }

    private partial void AttachPlatformHooks(Window window)
    {
        _windowsAppWindow = GetWindowsAppWindow(window);
        if (_windowsAppWindow is not null)
            _windowsAppWindow.Changed += OnWindowsAppWindowChanged;
    }

    private partial void DetachPlatformHooks()
    {
        if (_windowsAppWindow is not null)
            _windowsAppWindow.Changed -= OnWindowsAppWindowChanged;

        _windowsAppWindow = null;
    }

    private async void OnWindowsAppWindowChanged(AppWindow sender, AppWindowChangedEventArgs args)
    {
        if (_trackedWindow is null)
            return;

        try
        {
            var info = await MainThread.InvokeOnMainThreadAsync(() => SnapshotWindow(_trackedWindow));

            if (args.DidSizeChange)
                await EmitEventAsync(AppWindowEvents.Resized, info);

            await EmitStateChangedIfNeededAsync(info, force: args.DidPresenterChange);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Vidra.AppWindow] Failed to handle AppWindow change: {ex.Message}");
        }
    }

    private static AppWindow? GetWindowsAppWindow(Window window)
    {
        if (window.Handler?.PlatformView is not Microsoft.UI.Xaml.Window nativeWindow)
            return null;

        var handle = WindowNative.GetWindowHandle(nativeWindow);
        var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(handle);
        return AppWindow.GetFromWindowId(windowId);
    }

    private static OverlappedPresenter GetWindowsOverlappedPresenter(Window window, bool ensureOverlapped)
    {
        var appWindow = GetWindowsAppWindow(window)
            ?? throw new InvalidOperationException("No native Windows app window is available.");

        if (appWindow.Presenter is OverlappedPresenter presenter)
            return presenter;

        if (!ensureOverlapped)
            throw new InvalidOperationException("The native Windows window is not using an overlapped presenter.");

        appWindow.SetPresenter(AppWindowPresenterKind.Default);

        return appWindow.Presenter as OverlappedPresenter
            ?? throw new InvalidOperationException("Failed to switch the Windows window to an overlapped presenter.");
    }

    private WindowState DetectWindowsWindowState(Window window)
    {
        var appWindow = GetWindowsAppWindow(window);
        if (appWindow is null)
            return _lastKnownState;

        if (appWindow.Presenter.Kind == AppWindowPresenterKind.FullScreen)
            return WindowState.Fullscreen;

        if (appWindow.Presenter is OverlappedPresenter presenter)
        {
            return presenter.State switch
            {
                OverlappedPresenterState.Maximized => WindowState.Maximized,
                OverlappedPresenterState.Minimized => WindowState.Minimized,
                _ => WindowState.Restored
            };
        }

        return _lastKnownState;
    }
}
#endif
