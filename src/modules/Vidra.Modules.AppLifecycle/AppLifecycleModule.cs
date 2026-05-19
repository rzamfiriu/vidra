using Vidra.Bridge;

namespace Vidra.Modules.AppLifecycle;

public record AppInfoResult(
    string AppName,
    string PackageName,
    string Version,
    string Build,
    string Platform,
    string Idiom
);

public record ThemeResult(string Theme);

[BridgeModule("app")]
public sealed class AppLifecycleModule : BridgeModuleBase
{
    [BridgeMethod("getInfo")]
    public Task<AppInfoResult> GetInfoAsync(CancellationToken ct)
    {
        return Task.FromResult(new AppInfoResult(
            AppInfo.Current.Name,
            AppInfo.Current.PackageName,
            AppInfo.Current.VersionString,
            AppInfo.Current.BuildString,
            DeviceInfo.Current.Platform.ToString(),
            DeviceInfo.Current.Idiom.ToString()
        ));
    }

    [BridgeMethod("getTheme")]
    public Task<ThemeResult> GetThemeAsync(CancellationToken ct)
    {
        var theme = Application.Current?.RequestedTheme.ToString() ?? "Unknown";
        return Task.FromResult(new ThemeResult(theme));
    }
}
