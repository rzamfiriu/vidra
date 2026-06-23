namespace Vidra.Bridge;

/// <summary>
/// Implemented by bridge modules that push events to the JS layer (e.g.
/// connectivity or battery changes). The host attaches the live
/// <see cref="IJsCallbackChannel"/> once the WebView is ready.
/// </summary>
/// <remarks>
/// Implementations MUST be idempotent: <see cref="AttachCallbackChannel"/> can
/// be called more than once (for example when a new page/WebView is created),
/// and must not subscribe to the same underlying platform event twice.
/// </remarks>
public interface IBridgeEventSource
{
    void AttachCallbackChannel(IJsCallbackChannel channel);
}
