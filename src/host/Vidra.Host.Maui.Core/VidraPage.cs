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
        if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("VIDRA_DEV_URL")))
            Console.WriteLine("[vidra] host ready");
    }

    private void LoadContent()
    {
        var devServerUrl = Environment.GetEnvironmentVariable("VIDRA_DEV_URL");

        if (!string.IsNullOrEmpty(devServerUrl))
        {
            AppWebView.Source = new UrlWebViewSource { Url = devServerUrl };
        }
        else if (System.Diagnostics.Debugger.IsAttached)
        {
            AppWebView.Source = new UrlWebViewSource { Url = "http://localhost:5173" };
        }
        else
        {
            Bridge.LoadProductionAssets(AppWebView);
        }
    }
}
