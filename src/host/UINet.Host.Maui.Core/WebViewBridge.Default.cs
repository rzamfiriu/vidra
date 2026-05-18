#if !WINDOWS && !IOS && !MACCATALYST
namespace UINet.Hosting;

public sealed partial class WebViewBridge
{
    partial void LoadProductionAssetsCore(WebView webView)
    {
        throw new PlatformNotSupportedException("Production asset loading is not supported on this platform.");
    }
}
#endif
