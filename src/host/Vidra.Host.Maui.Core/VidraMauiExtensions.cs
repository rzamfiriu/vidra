using Vidra.Bridge;
using Vidra.Modules.FileSystem;
using Vidra.Modules.Dialogs;
using Vidra.Modules.Clipboard;
using Vidra.Modules.Notifications;
using Vidra.Modules.AppLifecycle;
using Vidra.Modules.Windowing;
using Vidra.Modules.Essentials;
#if ANDROID
using Microsoft.Maui.LifecycleEvents;
#endif

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
        var accessPolicy = BridgePolicyLoader.Load();
        builder.Services.AddSingleton<IBridgeAccessPolicy>(accessPolicy);

        builder.Services.AddSingleton<BridgeDispatcher>(sp =>
        {
            var dispatcher = new BridgeDispatcher(accessPolicy);
            dispatcher.Register(new FileSystemModule(
                accessPolicy.Document.FileSystem,
                BridgeFileSystemRoots.Resolve));
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
            dispatcher.ValidateAccessPolicy();
            return dispatcher;
        });

        builder.Services.AddSingleton<WebViewBridge>();

        // Registration of the built-in contracts rides on constructing the
        // modules, so anything reading a fingerprint before the first page would
        // otherwise hash a partial manifest. See VidraContractWarmup.
        builder.Services.AddSingleton<Microsoft.Maui.Hosting.IMauiInitializeService, VidraContractWarmup>();

        EnableWebViewInspection(builder);

        return builder;
    }

    /// <summary>
    /// Turns on over-the-air JS bundle updates. Call after <see cref="UseVidra"/>.
    /// </summary>
    /// <remarks>
    /// With no arguments the app is configured by the <c>updates</c> block in
    /// <c>vidra.config.ts</c>, which <c>vidra build</c> stamps into the
    /// bundle — no feed URL there means nothing is ever checked, so calling this
    /// unconditionally (as the template does) costs an app that does not want
    /// updates nothing but a state file read.
    ///
    /// Native code is never updated this way. A bundle only installs when both
    /// contract fingerprints match the running host, so a JS bundle can never
    /// call a bridge the installed binary does not have.
    /// </remarks>
    public static MauiAppBuilder UseVidraUpdates(
        this MauiAppBuilder builder,
        Action<VidraUpdateOptions>? configure = null)
    {
        var options = new VidraUpdateOptions();
        configure?.Invoke(options);

        builder.Services.AddSingleton(options);
        builder.Services.AddSingleton<VidraUpdateService>();
        builder.Services.AddSingleton<IVidraUpdates>(sp => sp.GetRequiredService<VidraUpdateService>());
        builder.Services.AddSingleton<Microsoft.Maui.Hosting.IMauiInitializeService, VidraUpdateStartup>();

#if ANDROID
        // Intent overrides are applied by MainActivity before base.OnCreate.
        // Start from MAUI's lifecycle rather than copied app startup code; the
        // VidraPage call remains an idempotent ordering fallback before its
        // first navigation.
        builder.ConfigureLifecycleEvents(events =>
        {
            events.AddAndroid(android => android.OnCreate((_, _) =>
            {
                IPlatformApplication.Current?.Services
                    .GetService<VidraUpdateService>()
                    ?.StartAtLaunch();
            }));
        });
#endif

        return builder;
    }

    /// <summary>
    /// Enables platform WebView inspection at runtime.
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
#elif ANDROID
        if ((Android.App.Application.Context.ApplicationInfo?.Flags
                & Android.Content.PM.ApplicationInfoFlags.Debuggable) != 0)
            Android.Webkit.WebView.SetWebContentsDebuggingEnabled(true);
#endif
    }
}
