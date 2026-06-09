#if IOS || MACCATALYST
using Foundation;
using WebKit;

namespace Vidra.Hosting;

public sealed partial class WebViewBridge
{
    partial void AttachPlatformChannel(WebView webView)
    {
        void Wire()
        {
            if (webView.Handler?.PlatformView is not WKWebView wk)
                return;

            var controller = wk.Configuration.UserContentController;

            // Re-attaching (e.g. the handler is recreated) must not double-register,
            // which WebKit rejects. Removing a not-yet-added name is a harmless no-op
            // on some OS versions and throws on others, so guard it.
            try { controller.RemoveScriptMessageHandler(ChannelName); }
            catch { /* nothing was registered yet */ }

            controller.AddScriptMessageHandler(new VidraScriptMessageHandler(this), ChannelName);
        }

        if (webView.Handler is not null)
            Wire();
        else
            webView.HandlerChanged += (_, _) => Wire();
    }

    /// <summary>
    /// Receives <c>window.webkit.messageHandlers.vidra.postMessage(...)</c> calls
    /// from JS and forwards the payload to the bridge.
    /// </summary>
    private sealed class VidraScriptMessageHandler : NSObject, IWKScriptMessageHandler
    {
        private readonly WebViewBridge _bridge;

        public VidraScriptMessageHandler(WebViewBridge bridge) => _bridge = bridge;

        public void DidReceiveScriptMessage(WKUserContentController userContentController, WKScriptMessage message)
        {
            var json = (message.Body as NSString)?.ToString();
            if (!string.IsNullOrEmpty(json))
                _bridge.HandleNativeInbound(json);
        }
    }

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
