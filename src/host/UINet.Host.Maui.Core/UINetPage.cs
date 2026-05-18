using UINet.Modules.Windowing;

namespace UINet.Hosting;

/// <summary>
/// A ready-made <see cref="ContentPage"/> that hosts a full-screen <see cref="WebView"/>
/// connected to the UINet bridge. Uses runtime detection to choose between the Vite
/// dev server and bundled production assets.
/// </summary>
public class UINetPage : ContentPage
{
    protected WebView AppWebView { get; }
    protected WebViewBridge Bridge { get; }

    public UINetPage()
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

        LoadContent();
    }

    private void LoadContent()
    {
        var devServerUrl = Environment.GetEnvironmentVariable("UINET_DEV_URL");

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
