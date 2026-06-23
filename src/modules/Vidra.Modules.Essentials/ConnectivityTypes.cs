namespace Vidra.Modules.Essentials;

/// <summary>Module-owned mirror of MAUI's network access level.</summary>
public enum NetworkAccess
{
    Unknown,
    None,
    Local,
    ConstrainedInternet,
    Internet
}

/// <summary>Module-owned mirror of MAUI's active connection profile.</summary>
public enum ConnectionProfile
{
    Unknown,
    Bluetooth,
    Cellular,
    Ethernet,
    Wifi
}

public record ConnectivityStatus(NetworkAccess Access, ConnectionProfile[] Profiles);

public static class ConnectivityEvents
{
    public const string Changed = "connectivity.changed";
}
