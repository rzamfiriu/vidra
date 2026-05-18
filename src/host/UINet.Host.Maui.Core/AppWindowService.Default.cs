#if !WINDOWS && !MACCATALYST
using UINet.Modules.Windowing;

namespace UINet.Hosting;

public sealed partial class AppWindowService
{
    private static partial WindowSupport BuildSupportSnapshot()
    {
        return new WindowSupport(
            Platform: DeviceInfo.Current.Platform.ToString().ToLowerInvariant(),
            GetCurrent: true,
            Configure: true,
            SetTitle: true,
            SetSize: true,
            Center: false,
            Maximize: false,
            Minimize: false,
            Restore: false,
            SetFullscreen: false
        );
    }

    private partial void SubscribeWindowEvents(Window window)
    {
        window.SizeChanged += OnTrackedWindowSizeChanged;
    }

    private partial void UnsubscribeWindowEvents(Window window)
    {
        window.SizeChanged -= OnTrackedWindowSizeChanged;
    }

    private partial Task EmitProgrammaticStateChangeAsyncCore(WindowInfo info, CancellationToken ct)
    {
        return EmitStateChangedIfNeededAsync(info, force: true, ct);
    }

    private partial WindowState DetectWindowStateCore(Window window)
    {
        return _lastKnownState;
    }

    private partial void CenterPlatformWindowCore(Window window)
    {
        throw new PlatformNotSupportedException("Window centering is not supported on this platform.");
    }

    private partial void MaximizePlatformWindowCore(Window window)
    {
        throw new PlatformNotSupportedException("Window maximize is not supported on this platform.");
    }

    private partial void MinimizePlatformWindowCore(Window window)
    {
        throw new PlatformNotSupportedException("Window minimize is not supported on this platform.");
    }

    private partial void RestorePlatformWindowCore(Window window)
    {
        throw new PlatformNotSupportedException("Window restore is not supported on this platform.");
    }

    private partial void SetFullscreenPlatformWindowCore(Window window, bool enabled)
    {
        throw new PlatformNotSupportedException("Fullscreen is not supported on this platform.");
    }

    private partial void AttachPlatformHooks(Window window)
    {
    }

    private partial void DetachPlatformHooks()
    {
    }
}
#endif
