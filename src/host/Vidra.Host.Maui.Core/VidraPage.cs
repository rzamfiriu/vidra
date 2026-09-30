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
#if ANDROID
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
        else if (System.Diagnostics.Debugger.IsAttached)
        {
            NavigateWhenHandlerReady("http://localhost:5173");
        }
        else
        {
            Bridge.LoadProductionAssets(AppWebView);
        }
    }

    private void NavigateWhenHandlerReady(string url)
    {
        if (AppWebView.Handler is not null)
        {
            AppWebView.Source = new UrlWebViewSource { Url = url };
            return;
        }

        EventHandler? onHandlerChanged = null;
        onHandlerChanged = (_, _) =>
        {
            if (AppWebView.Handler is null)
                return;

            AppWebView.HandlerChanged -= onHandlerChanged;
            AppWebView.Source = new UrlWebViewSource { Url = url };
        };
        AppWebView.HandlerChanged += onHandlerChanged;
    }

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
