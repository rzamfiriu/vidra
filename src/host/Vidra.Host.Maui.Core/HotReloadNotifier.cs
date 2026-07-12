using System.Reflection.Metadata;
using Vidra.Bridge;

[assembly: MetadataUpdateHandler(typeof(Vidra.Hosting.HotReloadNotifier))]

namespace Vidra.Hosting;

public sealed record HotReloadedPayload(string[] UpdatedTypes);

[BridgeEventContract("runtime")]
public interface IRuntimeEvents
{
    [BridgeEvent("hotReloaded")]
    void HotReloaded(HotReloadedPayload payload);
}

/// <summary>
/// Bridges .NET Hot Reload into the web UI. When a `dotnet watch` session
/// applies a C# metadata delta, the runtime invokes
/// <see cref="UpdateApplication"/>, and we push a <c>vidra.hotReloaded</c>
/// bridge event so the frontend can react (show a reload badge, re-query
/// native state, and so on) without polling.
/// </summary>
/// <remarks>
/// The handler is discovered by naming convention via the assembly-level
/// <see cref="MetadataUpdateHandlerAttribute"/>. Outside a hot reload session
/// it is never invoked, so shipping it in the release package is harmless.
/// </remarks>
public static class HotReloadNotifier
{
    /// <summary>Invoked by the runtime after a hot reload delta is applied.</summary>
    internal static void UpdateApplication(Type[]? updatedTypes)
    {
        WebViewBridge? bridge;
        try
        {
            bridge = IPlatformApplication.Current?.Services.GetService<WebViewBridge>();
        }
        catch
        {
            // Hot reload fired before the MAUI app finished bootstrapping.
            return;
        }

        if (bridge is null)
            return;

        var payload = new HotReloadedPayload(
            updatedTypes?.Select(t => t.FullName ?? t.Name).ToArray() ?? []);

        // Fire-and-forget on the UI thread: EvaluateJavaScriptAsync requires
        // it, and a failed push (e.g. the WebView is mid-navigation) must
        // never take down the hot reload session.
        _ = MainThread.InvokeOnMainThreadAsync(async () =>
        {
            try
            {
                await bridge.SendEventAsync(RuntimeEvents.HotReloaded, payload);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine(
                    $"[Vidra] Failed to notify the UI about a hot reload: {ex.Message}");
            }
        });
    }
}
