using Vidra.Bridge;
using MauiBattery = Microsoft.Maui.Devices.Battery;
using MauiBatteryState = Microsoft.Maui.Devices.BatteryState;
using MauiBatteryPowerSource = Microsoft.Maui.Devices.BatteryPowerSource;
using MauiEnergySaverStatus = Microsoft.Maui.Devices.EnergySaverStatus;

namespace Vidra.Modules.Essentials;

/// <summary>
/// Reports battery charge/state via MAUI Essentials Battery and pushes a
/// <c>battery.changed</c> event when the level, state, or energy-saver status
/// changes. Devices without a battery report <see cref="BatteryState.NotPresent"/>.
/// </summary>
[BridgeModule("battery")]
public sealed class BatteryModule : BridgeModuleBase, IBridgeEventSource
{
    private readonly object _gate = new();
    private IJsCallbackChannel? _channel;
    private bool _subscribed;

    [BridgeMethod("getStatus")]
    public Task<BatteryStatus> GetStatusAsync(CancellationToken ct)
        => Task.FromResult(ReadStatus());

    public void AttachCallbackChannel(IJsCallbackChannel channel)
    {
        lock (_gate)
        {
            _channel = channel;
            if (_subscribed)
                return;

            MauiBattery.Default.BatteryInfoChanged += OnBatteryChanged;
            MauiBattery.Default.EnergySaverStatusChanged += OnEnergySaverChanged;
            _subscribed = true;
        }
    }

    private void OnBatteryChanged(object? sender, EventArgs e) => PushStatus();

    private void OnEnergySaverChanged(object? sender, EventArgs e) => PushStatus();

    private void PushStatus()
    {
        _ = _channel?.SendEventAsync(BatteryEvents.Changed, ReadStatus());
    }

    private static BatteryStatus ReadStatus()
    {
        try
        {
            var battery = MauiBattery.Default;
            return new BatteryStatus(
                battery.ChargeLevel,
                MapState(battery.State),
                MapPowerSource(battery.PowerSource),
                MapEnergySaver(battery.EnergySaverStatus));
        }
        catch (Exception)
        {
            // Some desktops without a battery throw rather than reporting
            // NotPresent; surface a stable "unknown" status instead of failing.
            return new BatteryStatus(0, BatteryState.Unknown, BatteryPowerSource.Unknown, EnergySaverStatus.Unknown);
        }
    }

    private static BatteryState MapState(MauiBatteryState state) => state switch
    {
        MauiBatteryState.Charging => BatteryState.Charging,
        MauiBatteryState.Discharging => BatteryState.Discharging,
        MauiBatteryState.Full => BatteryState.Full,
        MauiBatteryState.NotCharging => BatteryState.NotCharging,
        MauiBatteryState.NotPresent => BatteryState.NotPresent,
        _ => BatteryState.Unknown,
    };

    private static BatteryPowerSource MapPowerSource(MauiBatteryPowerSource source) => source switch
    {
        MauiBatteryPowerSource.Battery => BatteryPowerSource.Battery,
        MauiBatteryPowerSource.AC => BatteryPowerSource.Ac,
        MauiBatteryPowerSource.Wireless => BatteryPowerSource.Wireless,
        _ => BatteryPowerSource.Unknown,
    };

    private static EnergySaverStatus MapEnergySaver(MauiEnergySaverStatus status) => status switch
    {
        MauiEnergySaverStatus.On => EnergySaverStatus.On,
        MauiEnergySaverStatus.Off => EnergySaverStatus.Off,
        _ => EnergySaverStatus.Unknown,
    };
}
