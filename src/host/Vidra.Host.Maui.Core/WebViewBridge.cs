using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Vidra.Bridge;

namespace Vidra.Hosting;

/// <summary>
/// Connects a MAUI <see cref="WebView"/> to the <see cref="BridgeDispatcher"/>.
/// Intercepts <c>vidra://bridge</c> navigation requests from JS and dispatches them.
/// Pushes responses and events back via <c>EvaluateJavaScriptAsync</c>.
/// </summary>
public sealed partial class WebViewBridge : IJsCallbackChannel, IUnsafeJsCallbackChannel
{
    /// <summary>
    /// Name of the native message channel. JS posts to
    /// <c>window.webkit.messageHandlers.vidra</c> (WKWebView) or
    /// <c>window.chrome.webview</c> (WebView2), or
    /// <c>window.vidra</c> (Android WebView); see the platform partials.
    /// Kept in sync with <c>NATIVE_CHANNEL</c> in the JS SDK transport.
    /// </summary>
    private const string ChannelName = "vidra";

    private readonly BridgeDispatcher _dispatcher;
    private readonly VidraBridgeOptions _options;
    private readonly ILogger<WebViewBridge> _logger;
    private readonly ConcurrentDictionary<string, byte> _reportedDeniedEvents = new();
    private readonly PendingJsCallRegistry _pendingJsCalls = new();
    private WebView? _webView;

    public WebViewBridge(
        BridgeDispatcher dispatcher,
        ILogger<WebViewBridge> logger,
        VidraBridgeOptions? options = null)
    {
        _dispatcher = dispatcher;
        _logger = logger;
        _options = options ?? new VidraBridgeOptions();
    }

    public IUnsafeJsCallbackChannel Unsafe => this;

    public void Attach(WebView webView)
    {
        _webView = webView;

        webView.Navigating += OnNavigating;
        webView.Navigated += OnNavigated;

        // Preferred transport: a first-class native message channel. The
        // custom-scheme navigation handling above remains as a fallback for
        // platforms (or timing windows) where the channel isn't available.
        AttachPlatformChannel(webView);
    }

    /// <summary>
    /// Wires up the platform-native JS→C# message channel (WKWebView script
    /// message handler / WebView2 web messages). Implemented per-platform.
    /// </summary>
    partial void AttachPlatformChannel(WebView webView);

    /// <summary>
    /// Handles a tagged frame (<c>{ "kind": "request" | "reverse", "data": ... }</c>)
    /// received over the native message channel, reusing the same dispatch and
    /// reverse-RPC paths as the custom-scheme transport.
    /// </summary>
    private void HandleNativeInbound(string frameJson) => _ = HandleNativeInboundAsync(frameJson);

    private async Task HandleNativeInboundAsync(string frameJson)
    {
        string kind;
        string dataJson;
        try
        {
            using var doc = JsonDocument.Parse(frameJson);
            var root = doc.RootElement;
            kind = root.GetProperty("kind").GetString() ?? string.Empty;
            dataJson = root.GetProperty("data").GetRawText();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Vidra] Failed to parse native frame: {ex.Message}");
            return;
        }

        // A frame arrived over the native channel, so the bundle's JavaScript has
        // parsed, run, and constructed the SDK's transport. Nothing weaker than a
        // booted bundle can produce one.
        AnnounceBundleBoot();

        if (string.Equals(kind, "reverse", StringComparison.OrdinalIgnoreCase))
        {
            HandleReverseResponse(dataJson);
            return;
        }

        var response = await _dispatcher.DispatchAsync(dataJson);
        await PushToJsAsync($"window.__vidra_callback({response})");
    }

    /// <summary>
    /// Raised once per process when the loaded web bundle has proved it runs.
    /// </summary>
    /// <remarks>
    /// This is what clears an updated bundle's probation, so it has to mean
    /// something a broken bundle cannot fake. Two things say it, and whichever
    /// happens first wins:
    /// <list type="bullet">
    /// <item>a frame arrived from JS — only the SDK's transport sends those, so
    /// the bundle's JavaScript has parsed, run and reached native;</item>
    /// <item>the page has installed <c>window.__vidra_initialize</c>, which the
    /// SDK does while constructing its client. This covers a bundle that boots
    /// the SDK and never calls into native.</item>
    /// </list>
    ///
    /// The inbound frame is the one that normally fires, and it exists because
    /// the poll alone was not enough: it takes its first sample a quarter of a
    /// second after navigation completes, and an app whose page is already
    /// talking to native by then can finish its work and exit inside that
    /// window. When that happened the bundle stayed on probation, and two silent
    /// launches later a perfectly good bundle was rolled back and blocked.
    ///
    /// What neither proves is that the app rendered anything. A bundle whose own
    /// code throws after the SDK is up still counts as booted here, and would not
    /// be rolled back. Closing that gap needs the JS side to say so explicitly,
    /// which is a bridge contract change and deliberately not in the first
    /// version.
    /// </remarks>
    public event Action? BundleBooted;

    private int _bundleBootAnnounced;

    /// <summary>
    /// Raises <see cref="BundleBooted"/> exactly once, whichever proof arrives
    /// first and on whichever thread carries it.
    /// </summary>
    private void AnnounceBundleBoot()
    {
        if (Interlocked.Exchange(ref _bundleBootAnnounced, 1) != 0)
            return;

        BundleBooted?.Invoke();
    }

    private async void OnNavigated(object? sender, WebNavigatedEventArgs e)
    {
#if ANDROID
        if (!_androidNativeChannelAvailable)
        {
            try
            {
                await PushToJsAsync(
                    "document.body.innerHTML='<main style=\"font-family:sans-serif;padding:2rem\"><h1>Android System WebView is outdated</h1><p>Update it to enable Vidra\\'s secure native bridge.</p></main>'");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to render the Android WebView compatibility diagnostic.");
            }
            return;
        }
#endif

        // Both pushes are guarded, and the watcher starts either way. This is an
        // `async void` event handler, so an escaping exception is an unhandled
        // one; and on Windows the first push is a real thrower —
        // EvaluateJavaScriptAsync reports "a valid CoreWebView2 is not present"
        // when the handler is between platform views, which has been seen on CI.
        // Letting that skip the watcher would leave a promoted bundle with
        // nothing to clear its probation.
        try
        {
            await PushToJsAsync("window.__vidra_native = true");

            var handshake = new BridgeHandshake
            {
                ProtocolVersion = BridgeProtocol.Version,
                CoreFingerprint = BridgeContractRegistry.Fingerprint(BridgeManifestScope.Core),
                AppFingerprint = BridgeContractRegistry.Fingerprint(BridgeManifestScope.App),
                AccessFingerprint = _dispatcher.AccessPolicy.Fingerprint,
            };

            // Protocol mismatch handling renders its diagnostic before throwing
            // in JavaScript; keep the native UI thread alive so it remains visible.
            await PushToJsAsync($"window.__vidra_initialize({BridgeSerializer.Serialize(handshake)})");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine(
                $"[Vidra] Bridge protocol initialization failed: {ex.Message}");
        }

        if (BundleBooted is not null)
            _ = WatchBundleBootAsync();
    }

    /// <summary>
    /// Polls for the SDK's presence rather than assuming it is there when
    /// navigation completes: the document is "navigated" before its scripts have
    /// run, so a single check would report every bundle broken.
    /// </summary>
    /// <remarks>
    /// The first sample is taken straight away and the wait moved to the end of
    /// the loop. Sleeping first cost a quarter of a second on every launch, in
    /// the one place where the app may already have everything it needs to exit.
    /// </remarks>
    private async Task WatchBundleBootAsync()
    {
        const int attempts = 40;

        for (var attempt = 0; attempt < attempts && Volatile.Read(ref _bundleBootAnnounced) == 0; attempt++)
        {
            string? answer;
            try
            {
                answer = await MainThread.InvokeOnMainThreadAsync(
                    () => _webView?.EvaluateJavaScriptAsync(
                        "String(typeof window.__vidra_initialize === 'function')")
                        ?? Task.FromResult<string>(null!));
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[Vidra] boot probe failed: {ex.Message}");
                await Task.Delay(TimeSpan.FromMilliseconds(250));
                continue;
            }

            // Platforms disagree about whether a JS string comes back quoted.
            if (answer?.Trim().Trim('"') == "true")
            {
                AnnounceBundleBoot();
                return;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(250));
        }
    }

    private async void OnNavigating(object? sender, WebNavigatingEventArgs e)
    {
#if ANDROID
        // Android's supported transport is origin-scoped WebMessageListener.
        // The scheme fallback cannot identify a subframe's origin, so accepting
        // it would let embedded remote content invoke granted native methods.
        // Consequently this path is never Android's bundle-boot proof; the
        // message listener or SDK initialization probe owns that signal.
        if (e.Url.StartsWith("vidra://", StringComparison.OrdinalIgnoreCase))
        {
            e.Cancel = true;
            _logger.LogWarning(
                "Rejected Android custom-scheme bridge traffic; update Android System WebView to use the secure native channel.");
            return;
        }
#endif

        if (e.Url.StartsWith("vidra://reverse", StringComparison.OrdinalIgnoreCase))
        {
            e.Cancel = true;
            AnnounceBundleBoot();
            var payload = Uri.UnescapeDataString(e.Url.Substring("vidra://reverse?payload=".Length));
            HandleReverseResponse(payload);
            return;
        }

        if (!e.Url.StartsWith("vidra://bridge", StringComparison.OrdinalIgnoreCase))
            return;

        e.Cancel = true;

        // Same claim as the native channel, on the transport platforms fall back
        // to: only the SDK navigates to vidra://.
        AnnounceBundleBoot();

        var bridgePayload = Uri.UnescapeDataString(e.Url.Substring("vidra://bridge?payload=".Length));
        var response = await _dispatcher.DispatchAsync(bridgePayload);

        await PushToJsAsync($"window.__vidra_callback({response})");
    }

    public Task SendEventAsync(BridgeEventToken eventToken, CancellationToken ct = default)
        => SendEventCoreAsync(eventToken.Contract, eventToken.Member, null, ct);

    public Task SendEventAsync<TPayload>(
        BridgeEventToken<TPayload> eventToken,
        TPayload payload,
        CancellationToken ct = default)
        => SendEventCoreAsync(
            eventToken.Contract,
            eventToken.Member,
            eventToken.SerializePayload(payload),
            ct);

    Task IUnsafeJsCallbackChannel.SendEventAsync(
        string contract,
        string member,
        object? payload,
        CancellationToken ct)
        => SendEventCoreAsync(contract, member, SerializeUnsafePayload(payload), ct);

    private async Task SendEventCoreAsync(
        string contract,
        string member,
        JsonElement? payload,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        if (!_dispatcher.AccessPolicy.AllowsEvent(contract, member))
        {
            if (_reportedDeniedEvents.TryAdd($"{contract}\0{member}", 0))
            {
                _logger.LogInformation(
                    "Dropped ungranted bridge event {Contract}.{Member}.",
                    contract,
                    member);
            }
            return;
        }

        var bridgeEvent = new BridgeEvent
        {
            Contract = contract,
            Member = member,
            Payload = payload,
        };
        var json = BridgeSerializer.Serialize(bridgeEvent);
        await PushToJsAsync($"window.__vidra_onevent({json})");
    }

    public async Task CallJsAsync(JsMethodToken method, CancellationToken ct = default)
        => await CallJsCoreAsync(method.Contract, method.Member, null, ct);

    public async Task<TResult> CallJsAsync<TResult>(
        JsMethodToken<TResult> method,
        CancellationToken ct = default)
    {
        var response = await CallJsCoreAsync(method.Contract, method.Member, null, ct);
        return DeserializeResult(response, method.DeserializeResult);
    }

    public async Task CallJsAsync<TPayload>(
        JsMethodPayloadToken<TPayload> method,
        TPayload payload,
        CancellationToken ct = default)
        => await CallJsCoreAsync(
            method.Contract,
            method.Member,
            method.SerializePayload(payload),
            ct);

    public async Task<TResult> CallJsAsync<TPayload, TResult>(
        JsMethodToken<TPayload, TResult> method,
        TPayload payload,
        CancellationToken ct = default)
    {
        var response = await CallJsCoreAsync(
            method.Contract,
            method.Member,
            method.SerializePayload(payload),
            ct);
        return DeserializeResult(response, method.DeserializeResult);
    }

    async Task<TResult> IUnsafeJsCallbackChannel.CallJsAsync<TResult>(
        string contract,
        string member,
        object? payload,
        CancellationToken ct)
    {
        var response = await CallJsCoreAsync(contract, member, SerializeUnsafePayload(payload), ct);

        if (response.Data is null || response.Data.Value.ValueKind == JsonValueKind.Null)
            return default!;

        return JsonSerializer.Deserialize<TResult>(
            response.Data.Value.GetRawText(),
            BridgeSerializer.Default)!;
    }

    private async Task<ReverseResponse> CallJsCoreAsync(
        string contract,
        string member,
        JsonElement? payload,
        CancellationToken ct)
    {
        var pending = _pendingJsCalls.Create(contract, member);

        try
        {
            var request = new ReverseRequest
            {
                Id = pending.Id,
                Contract = contract,
                Member = member,
                Payload = payload,
            };
            var requestJson = BridgeSerializer.Serialize(request);
            await PushToJsAsync($"window.__vidra_invoke({requestJson})");

            var responseJson = await _pendingJsCalls.WaitAsync(
                pending,
                _options.JsContractTimeout,
                ct);

            var response = JsonSerializer.Deserialize<ReverseResponse>(responseJson, BridgeSerializer.Default)
                ?? throw new JsRemoteException(
                    "JS_RESPONSE_INVALID",
                    $"JavaScript contract '{contract}.{member}' returned an invalid response.");

            if (!response.Success)
            {
                var code = response.Error?.Code ?? "JS_HANDLER_ERROR";
                var message = response.Error?.Message ?? "Unknown error from JavaScript handler.";
                throw new JsRemoteException(code, message);
            }

            return response;
        }
        finally
        {
            _pendingJsCalls.Remove(pending.Id);
        }
    }

    private static TResult DeserializeResult<TResult>(
        ReverseResponse response,
        Func<JsonElement, TResult> deserialize)
    {
        if (response.Data is null || response.Data.Value.ValueKind == JsonValueKind.Null)
            return default!;

        return deserialize(response.Data.Value);
    }

    private static JsonElement? SerializeUnsafePayload(object? payload)
        => payload is null
            ? null
            : JsonSerializer.SerializeToElement(payload, payload.GetType(), BridgeSerializer.Default);

    private void HandleReverseResponse(string responseJson)
    {
        try
        {
            var response = JsonSerializer.Deserialize<ReverseResponse>(responseJson, BridgeSerializer.Default);
            if (response is not null)
                _pendingJsCalls.TryComplete(response.Id, responseJson);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Vidra] Failed to parse reverse response: {ex.Message}");
        }
    }

    /// <summary>
    /// Sets the WebView source to bundled assets for the current platform (production builds).
    /// Uses platform-specific APIs to ensure ES module scripts can load from local files.
    /// </summary>
    public void LoadProductionAssets(WebView webView)
    {
        LoadProductionAssetsCore(webView);
    }

    private async Task PushToJsAsync(string js)
    {
        if (_webView is null) return;

        await MainThread.InvokeOnMainThreadAsync(async () =>
        {
            await _webView.EvaluateJavaScriptAsync(js);
        });
    }

    partial void LoadProductionAssetsCore(WebView webView);
}
