#if WINDOWS
namespace Vidra.Hosting;

public sealed partial class WebViewBridge
{
    partial void LoadProductionAssetsCore(WebView webView)
    {
        webView.Source = new UrlWebViewSource { Url = "wwwroot/index.html" };
    }
}
#endif
