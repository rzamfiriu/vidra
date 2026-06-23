using Microsoft.Maui.Devices;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public record DeviceInfoResult(
    string Model,
    string Manufacturer,
    string Name,
    string Version,
    string Platform,
    string Idiom,
    string DeviceType
);

public record DisplayInfoResult(
    double Width,
    double Height,
    double Density,
    string Orientation,
    string Rotation
);

/// <summary>
/// Read-only hardware/display information via MAUI Essentials
/// <see cref="DeviceInfo"/> and <see cref="DeviceDisplay"/>. Enum-like values
/// are surfaced as descriptive strings (e.g. platform/idiom/orientation).
/// </summary>
[BridgeModule("device")]
public sealed class DeviceModule : BridgeModuleBase
{
    [BridgeMethod("getInfo")]
    public Task<DeviceInfoResult> GetInfoAsync(CancellationToken ct)
    {
        var info = DeviceInfo.Current;
        return Task.FromResult(new DeviceInfoResult(
            info.Model,
            info.Manufacturer,
            info.Name,
            info.VersionString,
            info.Platform.ToString(),
            info.Idiom.ToString(),
            info.DeviceType.ToString()
        ));
    }

    [BridgeMethod("getDisplay")]
    public Task<DisplayInfoResult> GetDisplayAsync(CancellationToken ct)
    {
        var display = DeviceDisplay.Current.MainDisplayInfo;
        return Task.FromResult(new DisplayInfoResult(
            display.Width,
            display.Height,
            display.Density,
            display.Orientation.ToString(),
            display.Rotation.ToString()
        ));
    }
}
