namespace Vidra.Bridge;

/// <summary>
/// Abstraction for pushing events from C# into the JS layer.
/// The MAUI host provides the concrete implementation backed by WebView.EvaluateJavaScriptAsync.
/// </summary>
public interface IJsCallbackChannel
{
    Task SendEventAsync(BridgeEvent bridgeEvent, CancellationToken ct = default);
    Task<T> CallJsAsync<T>(string handler, object? payload = null, CancellationToken ct = default);
}
