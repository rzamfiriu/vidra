using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

/// <summary>Module-owned mirror of MAUI's battery charge state.</summary>
public enum BatteryState
{
    Unknown,
    Charging,
    Discharging,
    Full,
    NotCharging,
    NotPresent
}

/// <summary>Module-owned mirror of MAUI's power source.</summary>
public enum BatteryPowerSource
{
    Unknown,
    Battery,
    Ac,
    Wireless
}

/// <summary>Module-owned mirror of MAUI's energy-saver status.</summary>
public enum EnergySaverStatus
{
    Unknown,
    On,
    Off
}

public record BatteryStatus(
    double ChargeLevel,
    BatteryState State,
    BatteryPowerSource PowerSource,
    EnergySaverStatus EnergySaver
);

[BridgeEventContract("battery")]
public interface IBatteryEvents
{
    [BridgeEvent("changed")]
    void Changed(BatteryStatus payload);
}
