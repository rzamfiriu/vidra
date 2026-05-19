using System.Collections.Concurrent;
using System.Text.Json;
using Vidra.Bridge;

namespace Vidra.Hosting;

/// <summary>
/// Connects a MAUI <see cref="WebView"/> to the <see cref="BridgeDispatcher"/>.
/// Intercepts <c>vidra://bridge</c> navigation requests from JS and dispatches them.
/// Pushes responses and events back via <c>EvaluateJavaScriptAsync</c>.
/// </summary>
public sealed partial class WebViewBridge : IJsCallbackChannel
{
    private readonly BridgeDispatcher _dispatcher;
    private readonly ConcurrentDictionary<string, TaskCompletionSource<string>> _pendingReverseCalls = new();
    private int _reverseIdCounter;
    private WebView? _webView;

    public WebViewBridge(BridgeDispatcher dispatcher)
    {
        _dispatcher = dispatcher;
    }

    public void Attach(WebView webView)
    {
        _webView = webView;

        webView.Navigating += OnNavigating;
        webView.Navigated += OnNavigated;
    }

    private async void OnNavigated(object? sender, WebNavigatedEventArgs e)
    {
        await PushToJsAsync("window.__vidra_native = true");
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

    public async Task SendEventAsync(BridgeEvent bridgeEvent, CancellationToken ct = default)
    {
        var json = BridgeSerializer.Serialize(bridgeEvent);
        await PushToJsAsync($"window.__vidra_onevent({json})");
    }

    public async Task<T> CallJsAsync<T>(string handler, object? payload = null, CancellationToken ct = default)
    {
        var id = $"rev_{Interlocked.Increment(ref _reverseIdCounter)}_{Environment.TickCount64}";
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pendingReverseCalls[id] = tcs;

        using var ctr = ct.Register(() =>
        {
            if (_pendingReverseCalls.TryRemove(id, out var removed))
                removed.TrySetCanceled(ct);
        });

        var request = new ReverseRequest { Id = id, Handler = handler, Payload = payload };
        var requestJson = BridgeSerializer.Serialize(request);
        await PushToJsAsync($"window.__vidra_invoke({requestJson})");

        var responseJson = await tcs.Task;
        var response = JsonSerializer.Deserialize<ReverseResponse>(responseJson, BridgeSerializer.Default);

        if (response is null)
            throw new InvalidOperationException("Failed to deserialize reverse RPC response.");

        if (!response.Success)
        {
            var code = response.Error?.Code ?? "UNKNOWN";
            var message = response.Error?.Message ?? "Unknown error from JS handler.";
            throw new InvalidOperationException($"[{code}] {message}");
        }

        if (response.Data is null || response.Data.Value.ValueKind == JsonValueKind.Null)
            return default!;

        return JsonSerializer.Deserialize<T>(response.Data.Value.GetRawText(), BridgeSerializer.Default)!;
    }

    private void HandleReverseResponse(string responseJson)
    {
        try
        {
            var response = JsonSerializer.Deserialize<ReverseResponse>(responseJson, BridgeSerializer.Default);
            if (response is not null && _pendingReverseCalls.TryRemove(response.Id, out var tcs))
            {
                tcs.TrySetResult(responseJson);
            }
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
