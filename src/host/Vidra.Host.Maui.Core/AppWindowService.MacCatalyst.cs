#if MACCATALYST
using System.Runtime.InteropServices;
using Foundation;
using ObjCRuntime;
using Vidra.Modules.Windowing;

namespace Vidra.Hosting;

public sealed partial class AppWindowService
{
    private static partial WindowSupport BuildSupportSnapshot()
    {
        return new WindowSupport(
            Platform: "maccatalyst",
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
        return DetectMacWindowState();
    }

    private partial void CenterPlatformWindowCore(Window window)
    {
        throw new PlatformNotSupportedException(
            "Centering the window is not currently supported on Mac Catalyst.");
    }

    private partial void MaximizePlatformWindowCore(Window window)
    {
        throw new PlatformNotSupportedException(
            "Maximizing the window is not currently supported on Mac Catalyst.");
    }

    private partial void MinimizePlatformWindowCore(Window window)
    {
        throw new PlatformNotSupportedException(
            "Minimizing the window is not currently supported on Mac Catalyst.");
    }

    private partial void RestorePlatformWindowCore(Window window)
    {
        throw new PlatformNotSupportedException(
            "Restoring the window is not currently supported on Mac Catalyst.");
    }

    private partial void SetFullscreenPlatformWindowCore(Window window, bool enabled)
    {
        throw new PlatformNotSupportedException(
            "Fullscreen is not currently supported on Mac Catalyst.");
    }

    private partial void AttachPlatformHooks(Window window)
    {
    }

    private partial void DetachPlatformHooks()
    {
    }

    [LibraryImport("/usr/lib/libobjc.A.dylib", EntryPoint = "objc_msgSend")]
    private static partial IntPtr IntPtr_objc_msgSend(IntPtr receiver, IntPtr selector);

    private WindowState DetectMacWindowState()
    {
        var nsWindow = GetMacKeyWindow();
        if (nsWindow is null)
            return _lastKnownState;

        if (IsMacFullscreen(nsWindow))
            return WindowState.Fullscreen;

        if (IsMacMiniaturized(nsWindow))
            return WindowState.Minimized;

        if (IsMacZoomed(nsWindow))
            return WindowState.Maximized;

        return WindowState.Restored;
    }

    private static NSObject? GetMacKeyWindow()
    {
        var nsApplicationClass = Class.GetHandle("NSApplication");
        if (nsApplicationClass == IntPtr.Zero)
            return null;

        var sharedApplicationHandle = IntPtr_objc_msgSend(
            nsApplicationClass,
            Selector.GetHandle("sharedApplication"));
        if (sharedApplicationHandle == IntPtr.Zero)
            return null;

        var keyWindowHandle = IntPtr_objc_msgSend(
            sharedApplicationHandle,
            Selector.GetHandle("keyWindow"));
        if (keyWindowHandle == IntPtr.Zero)
            return null;

        return Runtime.GetNSObject(keyWindowHandle);
    }

    private static bool IsMacMiniaturized(NSObject nsWindow)
    {
        return (nsWindow.ValueForKey(new NSString("miniaturized")) as NSNumber)?.BoolValue == true;
    }

    private static bool IsMacZoomed(NSObject nsWindow)
    {
        return (nsWindow.ValueForKey(new NSString("zoomed")) as NSNumber)?.BoolValue == true;
    }

    private static bool IsMacFullscreen(NSObject nsWindow)
    {
        const nuint fullscreenMask = 1u << 14;
        var styleMask = (nuint)((nsWindow.ValueForKey(new NSString("styleMask")) as NSNumber)?.UInt64Value ?? 0);
        return (styleMask & fullscreenMask) != 0;
    }
}
#endif
