#if WINDOWS
using Microsoft.Web.WebView2.Core;

namespace Vidra.Hosting;

public sealed partial class WebViewBridge
{
    partial void AttachPlatformChannel(WebView webView)
    {
        async void Wire()
        {
            if (webView.Handler?.PlatformView is not Microsoft.UI.Xaml.Controls.WebView2 webView2)
                return;

            try
            {
                await webView2.EnsureCoreWebView2Async();
                webView2.CoreWebView2.WebMessageReceived -= OnWebMessageReceived;
                webView2.CoreWebView2.WebMessageReceived += OnWebMessageReceived;
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[Vidra] Failed to wire WebView2 channel: {ex.Message}");
            }
        }

        if (webView.Handler is not null)
            Wire();
        else
            webView.HandlerChanged += (_, _) => Wire();
    }

    /// <summary>
    /// Receives <c>window.chrome.webview.postMessage(...)</c> calls from JS.
    /// </summary>
    private void OnWebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        try
        {
            HandleNativeInbound(args.TryGetWebMessageAsString());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Vidra] Failed to read web message: {ex.Message}");
        }
    }

    partial void LoadProductionAssetsCore(WebView webView)
    {
        webView.Source = new UrlWebViewSource { Url = "wwwroot/index.html" };
    }
}
#endif
