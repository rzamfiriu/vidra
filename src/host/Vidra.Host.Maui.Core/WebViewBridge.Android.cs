#if ANDROID
using Android.Webkit;
using AndroidX.WebKit;
using Microsoft.Maui.Handlers;
using Microsoft.Maui.Platform;
using AWebView = Android.Webkit.WebView;
using MauiWebView = Microsoft.Maui.Controls.WebView;

namespace Vidra.Hosting;

public sealed partial class WebViewBridge
{
    private const string VirtualHostName = "vidra.invalid";
    private VidraWebMessageListener? _messageListener;
    private bool _androidNativeChannelAvailable;

    partial void AttachPlatformChannel(MauiWebView webView)
    {
        void Wire()
        {
            if (webView.Handler?.PlatformView is not AWebView nativeView)
                return;

            if (!WebViewFeature.IsFeatureSupported(WebViewFeature.WebMessageListener))
            {
                Console.WriteLine(
                    "[vidra] Android WebView is too old for the secure native message channel; bridge traffic is disabled");
                return;
            }

            _messageListener ??= new VidraWebMessageListener(this);
            WebViewCompat.RemoveWebMessageListener(nativeView, ChannelName);
            WebViewCompat.AddWebMessageListener(
                nativeView,
                ChannelName,
                AllowedBridgeOrigins(),
                _messageListener);
            _androidNativeChannelAvailable = true;
        }

        if (webView.Handler is not null)
            Wire();

        // Unlike the first navigation, handler recreation has no Source mapper
        // ordering to lean on. Re-register on every new platform view; removal
        // above keeps this idempotent.
        webView.HandlerChanged += (_, _) => Wire();
    }

    private static ICollection<string> AllowedBridgeOrigins()
    {
        var origins = new HashSet<string>(StringComparer.Ordinal);
        origins.Add($"https://{VirtualHostName}");

        var devUrl = VidraRuntimeSettings.Get(VidraRuntimeSettings.DevUrl);
        if (Uri.TryCreate(devUrl, UriKind.Absolute, out var parsed))
            origins.Add(parsed.GetLeftPart(UriPartial.Authority));
        else if (System.Diagnostics.Debugger.IsAttached)
            origins.Add("http://localhost:5173");

        return origins;
    }

    partial void LoadProductionAssetsCore(MauiWebView webView)
    {
        var externalRoot = WebAssetRoot.Resolve();
        var context = Android.App.Application.Context;
        var builder = new WebViewAssetLoader.Builder();
        builder.SetDomain(VirtualHostName);

        string url;
        string announcedRoot;
        if (externalRoot is null)
        {
            builder.AddPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(context));
            url = $"https://{VirtualHostName}/wwwroot/index.html";
            announcedRoot = url;
        }
        else
        {
            builder.AddPathHandler(
                "/",
                new WebViewAssetLoader.InternalStoragePathHandler(
                    context,
                    new Java.IO.File(externalRoot)));
            url = $"https://{VirtualHostName}/index.html";
            announcedRoot = externalRoot;
        }

        var assetLoader = builder.Build()
            ?? throw new InvalidOperationException("Android WebView asset loader creation failed.");

        void Serve()
        {
            if (webView.Handler is not WebViewHandler handler)
                return;

            handler.PlatformView.SetWebViewClient(new VidraWebViewClient(handler, assetLoader));
            WebAssetRoot.Announce(
                announcedRoot,
                externalRoot is not null,
                $"WebViewAssetLoader at https://{VirtualHostName}");
            webView.Source = new UrlWebViewSource { Url = url };
        }

        if (webView.Handler is not null)
            Serve();

        webView.HandlerChanged += (_, _) => Serve();
    }

    private sealed class VidraWebMessageListener(WebViewBridge bridge)
        : Java.Lang.Object, WebViewCompat.IWebMessageListener
    {
        public void OnPostMessage(
            AWebView? webView,
            WebMessageCompat? message,
            Android.Net.Uri? sourceOrigin,
            bool isMainFrame,
            JavaScriptReplyProxy? replyProxy)
        {
            if (!isMainFrame)
                return;

            var frameJson = message?.Data;
            if (!string.IsNullOrWhiteSpace(frameJson))
                bridge.HandleNativeInbound(frameJson);
        }
    }

    private sealed class VidraWebViewClient(
        WebViewHandler handler,
        WebViewAssetLoader assetLoader) : MauiWebViewClient(handler)
    {
        public override WebResourceResponse? ShouldInterceptRequest(
            AWebView? view,
            IWebResourceRequest? request)
            => request?.Url is { } uri
                ? assetLoader.ShouldInterceptRequest(uri)
                    ?? base.ShouldInterceptRequest(view, request)
                : base.ShouldInterceptRequest(view, request);

#pragma warning disable CS0618, CS0672
        public override WebResourceResponse? ShouldInterceptRequest(AWebView? view, string? url)
        {
            var uri = string.IsNullOrWhiteSpace(url) ? null : Android.Net.Uri.Parse(url);
            return uri is null
                ? base.ShouldInterceptRequest(view, url)
                : assetLoader.ShouldInterceptRequest(uri)
                    ?? base.ShouldInterceptRequest(view, url);
        }
#pragma warning restore CS0618, CS0672
    }
}
#endif
