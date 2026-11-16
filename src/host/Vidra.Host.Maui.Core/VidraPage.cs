using Vidra.Bridge;
using Vidra.Modules.Windowing;

namespace Vidra.Hosting;

/// <summary>
/// A ready-made <see cref="ContentPage"/> that hosts a full-screen <see cref="WebView"/>
/// connected to the Vidra bridge. Uses runtime detection to choose between the Vite
/// dev server and bundled production assets.
/// </summary>
public class VidraPage : ContentPage
{
    protected WebView AppWebView { get; }
    protected WebViewBridge Bridge { get; }

    public VidraPage()
    {
#if ANDROID || IOS
        SafeAreaEdges = SafeAreaEdges.All;
#endif

        AppWebView = new WebView
        {
            HorizontalOptions = LayoutOptions.Fill,
            VerticalOptions = LayoutOptions.Fill,
        };

        Content = AppWebView;

        Bridge = IPlatformApplication.Current!.Services.GetRequiredService<WebViewBridge>();
        Bridge.Attach(AppWebView);
#if IOS || MACCATALYST
        AppWebView.ProcessTerminated += OnWebContentProcessTerminated;
#endif
        var appWindowService = IPlatformApplication.Current.Services.GetService<IAppWindowService>();
        appWindowService?.AttachCallbackChannel(Bridge);
        Loaded += (_, _) => appWindowService?.TrackPage(this);

        // Give every event-emitting module a live channel to push events on.
        // AttachCallbackChannel is idempotent, so re-creating the page is safe.
        var dispatcher = IPlatformApplication.Current.Services.GetService<BridgeDispatcher>();
        if (dispatcher is not null)
        {
            foreach (var module in dispatcher.Modules)
            {
                if (module is IBridgeEventSource eventSource)
                    eventSource.AttachCallbackChannel(Bridge);
            }
        }

#if ANDROID
        // The Android lifecycle hook normally starts updates after MainActivity
        // applies launch extras. Keep this idempotent fallback at the final
        // ordering boundary: before this page's first WebView navigation.
        IPlatformApplication.Current.Services
            .GetService<VidraUpdateService>()
            ?.StartAtLaunch();
#endif

        LoadContent();
        AnnounceDevHostReady();
    }

    /// <summary>
    /// Prints a stable sentinel to stdout in dev sessions. The `vidra` CLI
    /// scans host output for this line to know the app launched — under
    /// `dotnet watch` no SDK-version-stable "started" message exists, and the
    /// CLI uses launch state to decide between falling back to a classic
    /// build+run (watch died before the app ever ran) and a normal shutdown.
    /// </summary>
    private static void AnnounceDevHostReady()
    {
        if (!string.IsNullOrEmpty(VidraRuntimeSettings.Get(VidraRuntimeSettings.DevUrl)))
            Console.WriteLine("[vidra] host ready");
    }

    private void LoadContent()
    {
        var devServerUrl = VidraRuntimeSettings.Get(VidraRuntimeSettings.DevUrl);

        if (!string.IsNullOrEmpty(devServerUrl))
        {
            NavigateWhenHandlerReady(devServerUrl);
        }
#if !IOS
        // On iOS localhost is the device itself, and the CLI always supplies
        // VIDRA_DEV_URL, so a debugger is no evidence of a dev server.
        else if (System.Diagnostics.Debugger.IsAttached)
        {
            NavigateWhenHandlerReady("http://localhost:5173");
        }
#endif
        else
        {
            Bridge.LoadProductionAssets(AppWebView);
        }
    }

#if IOS || MACCATALYST
    private const int MaxReloadsPerWindow = 3;
    private static readonly TimeSpan ReloadWindow = TimeSpan.FromMinutes(1);
    private readonly Queue<DateTime> _recentTerminations = new();

    /// <summary>
    /// WebKit runs page content in a separate process, which iOS kills under
    /// memory pressure. The WebView survives it but shows nothing, so load the
    /// page again. A page that takes its own process down on load would
    /// otherwise reload forever, hence the cap.
    /// </summary>
    private void OnWebContentProcessTerminated(object? sender, WebViewProcessTerminatedEventArgs e)
    {
        Bridge.OnPageProcessTerminated();

        var now = DateTime.UtcNow;
        while (_recentTerminations.Count > 0 && now - _recentTerminations.Peek() > ReloadWindow)
            _recentTerminations.Dequeue();
        _recentTerminations.Enqueue(now);

        if (_recentTerminations.Count > MaxReloadsPerWindow)
        {
            Console.WriteLine(
                $"[vidra] web content process terminated {_recentTerminations.Count} times in {ReloadWindow.TotalSeconds:0}s; not reloading again");
            return;
        }

        Console.WriteLine("[vidra] web content process terminated; reloading the page");
        LoadContent();
    }
#endif

    private void NavigateWhenHandlerReady(string url)
    {
        if (AppWebView.Handler is not null)
        {
            Navigate(url);
            return;
        }

        EventHandler? onHandlerChanged = null;
        onHandlerChanged = (_, _) =>
        {
            if (AppWebView.Handler is null)
                return;

            AppWebView.HandlerChanged -= onHandlerChanged;
            Navigate(url);
        };
        AppWebView.HandlerChanged += onHandlerChanged;
    }

#if WINDOWS
    /// <summary>
    /// Navigates once the WebView2 has its CoreWebView2, the order
    /// <c>LoadProductionAssetsCore</c> already follows on Windows.
    /// </summary>
    /// <remarks>
    /// The bridge's Windows channel starts <c>EnsureCoreWebView2Async</c> from
    /// its own <c>HandlerChanged</c> handler, which runs before this page's. A
    /// <c>Source</c> set while that initialization is still pending is kept by
    /// the control and never navigated: measured on Windows 11 with WebView2
    /// 155, <c>WebView2.Source</c> read the dev server's URL for 48 seconds
    /// while <c>CoreWebView2.Source</c> stayed <c>about:blank</c>, no
    /// <c>Navigating</c> was raised, the window stayed blank and every C# to
    /// JavaScript call timed out. Waiting for the same initialization first
    /// makes the assignment an ordinary navigation.
    /// </remarks>
    private async void Navigate(string url)
    {
        if (AppWebView.Handler?.PlatformView is Microsoft.UI.Xaml.Controls.WebView2 webView2)
        {
            try
            {
                await webView2.EnsureCoreWebView2Async();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[vidra] WebView2 did not initialize ({ex.Message}); navigating to {url} anyway");
            }
        }

        AppWebView.Source = new UrlWebViewSource { Url = url };
    }
#else
    private void Navigate(string url) =>
        AppWebView.Source = new UrlWebViewSource { Url = url };
#endif

    protected override bool OnBackButtonPressed()
    {
        if (AppWebView.CanGoBack)
        {
            AppWebView.GoBack();
            return true;
        }

        return base.OnBackButtonPressed();
    }
}
