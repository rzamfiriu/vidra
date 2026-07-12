using System.Text.Json;
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
    /// <c>window.chrome.webview</c> (WebView2); see the platform partials.
    /// Kept in sync with <c>NATIVE_CHANNEL</c> in the JS SDK transport.
    /// </summary>
    private const string ChannelName = "vidra";

    private readonly BridgeDispatcher _dispatcher;
    private readonly VidraBridgeOptions _options;
    private readonly PendingJsCallRegistry _pendingJsCalls = new();
    private WebView? _webView;

    public WebViewBridge(BridgeDispatcher dispatcher, VidraBridgeOptions? options = null)
    {
        _dispatcher = dispatcher;
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

        if (string.Equals(kind, "reverse", StringComparison.OrdinalIgnoreCase))
        {
            HandleReverseResponse(dataJson);
            return;
        }

        var response = await _dispatcher.DispatchAsync(dataJson);
        await PushToJsAsync($"window.__vidra_callback({response})");
    }

    private async void OnNavigated(object? sender, WebNavigatedEventArgs e)
    {
        await PushToJsAsync("window.__vidra_native = true");

        var handshake = new BridgeHandshake
        {
            ProtocolVersion = BridgeProtocol.Version,
            CoreFingerprint = BridgeContractRegistry.Fingerprint(BridgeManifestScope.Core),
            AppFingerprint = BridgeContractRegistry.Fingerprint(BridgeManifestScope.App),
        };
        try
        {
            await PushToJsAsync($"window.__vidra_initialize({BridgeSerializer.Serialize(handshake)})");
        }
        catch (Exception ex)
        {
            // Protocol mismatch handling renders its diagnostic before throwing
            // in JavaScript; keep the native UI thread alive so it remains visible.
            System.Diagnostics.Debug.WriteLine(
                $"[Vidra] Bridge protocol initialization failed: {ex.Message}");
        }
    }

    private async void OnNavigating(object? sender, WebNavigatingEventArgs e)
    {
        if (e.Url.StartsWith("vidra://reverse", StringComparison.OrdinalIgnoreCase))
        {
            e.Cancel = true;
            var payload = Uri.UnescapeDataString(e.Url.Substring("vidra://reverse?payload=".Length));
            HandleReverseResponse(payload);
            return;
        }

        if (!e.Url.StartsWith("vidra://bridge", StringComparison.OrdinalIgnoreCase))
            return;

        e.Cancel = true;

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
