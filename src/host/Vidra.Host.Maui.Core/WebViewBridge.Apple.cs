#if IOS || MACCATALYST
namespace Vidra.Hosting;

public sealed partial class WebViewBridge
{
    partial void LoadProductionAssetsCore(WebView webView)
    {
        var resourcePath = Foundation.NSBundle.MainBundle.ResourcePath;
        var wwwrootPath = System.IO.Path.Combine(resourcePath, "wwwroot");
        var indexPath = System.IO.Path.Combine(wwwrootPath, "index.html");

        void Load()
        {
            if (webView.Handler?.PlatformView is WebKit.WKWebView wk)
            {
                var fileUrl = Foundation.NSUrl.FromFilename(indexPath);
                var accessUrl = Foundation.NSUrl.FromFilename(wwwrootPath);
                wk.LoadFileUrl(fileUrl, accessUrl);
            }
        }

        if (webView.Handler != null)
            Load();
        else
            webView.HandlerChanged += (_, _) => Load();
    }
}
#endif
