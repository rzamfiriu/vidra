#if !WINDOWS && !IOS && !MACCATALYST
namespace Vidra.Hosting;

public sealed partial class WebViewBridge
{
    partial void AttachPlatformChannel(WebView webView)
    {
        // No native message channel on this platform; the custom-scheme
        // transport (handled in WebViewBridge.OnNavigating) is used instead.
    }

    partial void LoadProductionAssetsCore(WebView webView)
    {
        throw new PlatformNotSupportedException("Production asset loading is not supported on this platform.");
    }
}
#endif
