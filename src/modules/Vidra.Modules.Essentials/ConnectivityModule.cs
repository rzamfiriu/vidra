using Vidra.Bridge;
using MauiConnectivity = Microsoft.Maui.Networking.Connectivity;
using MauiNetworkAccess = Microsoft.Maui.Networking.NetworkAccess;
using MauiConnectionProfile = Microsoft.Maui.Networking.ConnectionProfile;
using MauiConnectivityChangedEventArgs = Microsoft.Maui.Networking.ConnectivityChangedEventArgs;

namespace Vidra.Modules.Essentials;

/// <summary>
/// Reports network reachability via MAUI Essentials Connectivity and pushes a
/// <c>connectivity.changed</c> event when it changes. MAUI's enums are mapped
/// to module-owned enums so the wire contract is independent of MAUI.
/// </summary>
[BridgeModule("connectivity")]
public sealed class ConnectivityModule : BridgeModuleBase, IBridgeEventSource
{
    private readonly object _gate = new();
    private IJsCallbackChannel? _channel;
    private bool _subscribed;

    [BridgeMethod("getStatus")]
    public Task<ConnectivityStatus> GetStatusAsync(CancellationToken ct)
        => Task.FromResult(ReadStatus());

    public void AttachCallbackChannel(IJsCallbackChannel channel)
    {
        lock (_gate)
        {
            _channel = channel;
            if (_subscribed)
                return;

            MauiConnectivity.Current.ConnectivityChanged += OnConnectivityChanged;
            _subscribed = true;
        }
    }

    private void OnConnectivityChanged(object? sender, MauiConnectivityChangedEventArgs e)
    {
        var status = new ConnectivityStatus(
            MapAccess(e.NetworkAccess),
            e.ConnectionProfiles.Select(MapProfile).ToArray());

        _ = _channel?.SendEventAsync(ConnectivityEvents.Changed, status);
    }

    private static ConnectivityStatus ReadStatus()
    {
        var current = MauiConnectivity.Current;
        return new ConnectivityStatus(
            MapAccess(current.NetworkAccess),
            current.ConnectionProfiles.Select(MapProfile).ToArray());
    }

    private static NetworkAccess MapAccess(MauiNetworkAccess access) => access switch
    {
        MauiNetworkAccess.Internet => NetworkAccess.Internet,
        MauiNetworkAccess.ConstrainedInternet => NetworkAccess.ConstrainedInternet,
        MauiNetworkAccess.Local => NetworkAccess.Local,
        MauiNetworkAccess.None => NetworkAccess.None,
        _ => NetworkAccess.Unknown,
    };

    private static ConnectionProfile MapProfile(MauiConnectionProfile profile) => profile switch
    {
        MauiConnectionProfile.Bluetooth => ConnectionProfile.Bluetooth,
        MauiConnectionProfile.Cellular => ConnectionProfile.Cellular,
        MauiConnectionProfile.Ethernet => ConnectionProfile.Ethernet,
        MauiConnectionProfile.WiFi => ConnectionProfile.Wifi,
        _ => ConnectionProfile.Unknown,
    };
}
