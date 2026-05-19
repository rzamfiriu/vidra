using Vidra.Bridge;
using Vidra.Modules.FileSystem;
using Vidra.Modules.Dialogs;
using Vidra.Modules.Clipboard;
using Vidra.Modules.Notifications;
using Vidra.Modules.AppLifecycle;
using Vidra.Modules.Windowing;

namespace Vidra.Hosting;

public static class VidraMauiExtensions
{
    /// <summary>
    /// Registers the Vidra bridge, built-in modules, and WebView infrastructure.
    /// Call additional <c>dispatcher.Register(...)</c> in the <paramref name="configureModules"/>
    /// callback to add your own custom modules.
    /// </summary>
    public static MauiAppBuilder UseVidra(
        this MauiAppBuilder builder,
        Action<BridgeDispatcher>? configureModules = null)
    {
        builder.Services.AddSingleton<IAppWindowService, AppWindowService>();

        builder.Services.AddSingleton<BridgeDispatcher>(sp =>
        {
            var dispatcher = new BridgeDispatcher();
            dispatcher.Register(new FileSystemModule());
            dispatcher.Register(new DialogsModule());
            dispatcher.Register(new ClipboardModule());
            dispatcher.Register(new NotificationsModule());
            dispatcher.Register(new AppLifecycleModule());
            dispatcher.Register(new AppWindowModule(sp.GetRequiredService<IAppWindowService>()));
            configureModules?.Invoke(dispatcher);
            return dispatcher;
        });

        builder.Services.AddSingleton<WebViewBridge>();

        EnableWebViewInspection(builder);

        return builder;
    }

    /// <summary>
    /// Enables WKWebView.Inspectable at runtime so Safari DevTools can attach.
    /// Uses Debugger.IsAttached as a runtime check instead of #if DEBUG,
    /// since this library ships as a Release-built NuGet package.
    /// </summary>
    private static void EnableWebViewInspection(MauiAppBuilder builder)
    {
#if IOS || MACCATALYST
        Microsoft.Maui.Handlers.WebViewHandler.Mapper.AppendToMapping("Inspectable", (handler, view) =>
        {
            if (OperatingSystem.IsIOSVersionAtLeast(16, 4) || OperatingSystem.IsMacCatalystVersionAtLeast(16, 4))
                handler.PlatformView.Inspectable = true;
        });
#endif
    }
}
