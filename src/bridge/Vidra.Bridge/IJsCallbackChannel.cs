namespace Vidra.Bridge;

/// <summary>
/// Typed abstraction for pushing events and invoking JavaScript contracts.
/// The MAUI host provides the concrete implementation backed by WebView.EvaluateJavaScriptAsync.
/// </summary>
public interface IJsCallbackChannel
{
    IUnsafeJsCallbackChannel Unsafe { get; }

    Task SendEventAsync(BridgeEventToken eventToken, CancellationToken ct = default);
    Task SendEventAsync<TPayload>(
        BridgeEventToken<TPayload> eventToken,
        TPayload payload,
        CancellationToken ct = default);

    Task CallJsAsync(JsMethodToken method, CancellationToken ct = default);
    Task<TResult> CallJsAsync<TResult>(
        JsMethodToken<TResult> method,
        CancellationToken ct = default);
    Task CallJsAsync<TPayload>(
        JsMethodPayloadToken<TPayload> method,
        TPayload payload,
        CancellationToken ct = default);
    Task<TResult> CallJsAsync<TPayload, TResult>(
        JsMethodToken<TPayload, TResult> method,
        TPayload payload,
        CancellationToken ct = default);
}

/// <summary>
/// Explicit escape hatch for dynamic bridge traffic that has no generated contract.
/// Prefer generated event and JavaScript-contract APIs.
/// </summary>
public interface IUnsafeJsCallbackChannel
{
    Task SendEventAsync(
        string contract,
        string member,
        object? payload = null,
        CancellationToken ct = default);

    Task<TResult> CallJsAsync<TResult>(
        string contract,
        string member,
        object? payload = null,
        CancellationToken ct = default);
}
