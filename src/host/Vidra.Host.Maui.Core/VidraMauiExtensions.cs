using Vidra.Bridge;
using Vidra.Modules.FileSystem;
using Vidra.Modules.Dialogs;
using Vidra.Modules.Clipboard;
using Vidra.Modules.Notifications;
using Vidra.Modules.AppLifecycle;
using Vidra.Modules.Windowing;
using Vidra.Modules.Essentials;

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
        Action<BridgeDispatcher>? configureModules = null,
        Action<VidraBridgeOptions>? configureBridge = null)
    {
        var bridgeOptions = new VidraBridgeOptions();
        configureBridge?.Invoke(bridgeOptions);
        builder.Services.AddSingleton(bridgeOptions);
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

            // MAUI Essentials modules.
            dispatcher.Register(new SecureStorageModule());
            dispatcher.Register(new PreferencesModule());
            dispatcher.Register(new DeviceModule());
            dispatcher.Register(new ShareModule());
            dispatcher.Register(new BrowserModule());
            dispatcher.Register(new LauncherModule());
            dispatcher.Register(new EmailModule());
            dispatcher.Register(new FilePickerModule());
            dispatcher.Register(new TextToSpeechModule());
            dispatcher.Register(new ConnectivityModule());
            dispatcher.Register(new BatteryModule());
            dispatcher.Register(new EssentialsSupportModule());

            dispatcher.RegisterEvents(
                ConnectivityEvents.Changed.Contract,
                ConnectivityEvents.Changed.Member);
            dispatcher.RegisterEvents(
                BatteryEvents.Changed.Contract,
                BatteryEvents.Changed.Member);
            dispatcher.RegisterEvents(
                AppWindowEvents.Resized.Contract,
                AppWindowEvents.Resized.Member,
                AppWindowEvents.StateChanged.Member);
            dispatcher.RegisterEvents(
                RuntimeEvents.HotReloaded.Contract,
                RuntimeEvents.HotReloaded.Member);

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
