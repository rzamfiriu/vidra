using Microsoft.Maui.Storage;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public record PreferencesGetArgs(string Key);
public record PreferencesGetResult(string? Value);

public record PreferencesSetArgs(string Key, string Value);
public record PreferencesSetResult(bool Success);

public record PreferencesRemoveArgs(string Key);
public record PreferencesRemoveResult(bool Success);

public record PreferencesContainsArgs(string Key);
public record PreferencesContainsResult(bool Exists);

public record PreferencesClearResult(bool Success);

/// <summary>
/// Wraps MAUI Essentials <see cref="Preferences"/> for lightweight,
/// unencrypted key/value app settings. Use <c>secureStorage</c> for secrets.
/// </summary>
[BridgeModule("preferences")]
public sealed class PreferencesModule : BridgeModuleBase
{
    [BridgeMethod("get")]
    public Task<PreferencesGetResult> GetAsync(PreferencesGetArgs args, CancellationToken ct)
    {
        var value = Preferences.Default.ContainsKey(args.Key)
            ? Preferences.Default.Get(args.Key, string.Empty)
            : null;
        return Task.FromResult(new PreferencesGetResult(value));
    }

    [BridgeMethod("set")]
    public Task<PreferencesSetResult> SetAsync(PreferencesSetArgs args, CancellationToken ct)
    {
        Preferences.Default.Set(args.Key, args.Value);
        return Task.FromResult(new PreferencesSetResult(true));
    }

    [BridgeMethod("remove")]
    public Task<PreferencesRemoveResult> RemoveAsync(PreferencesRemoveArgs args, CancellationToken ct)
    {
        Preferences.Default.Remove(args.Key);
        return Task.FromResult(new PreferencesRemoveResult(true));
    }

    [BridgeMethod("containsKey")]
    public Task<PreferencesContainsResult> ContainsKeyAsync(PreferencesContainsArgs args, CancellationToken ct)
    {
        return Task.FromResult(new PreferencesContainsResult(Preferences.Default.ContainsKey(args.Key)));
    }

    [BridgeMethod("clear")]
    public Task<PreferencesClearResult> ClearAsync(CancellationToken ct)
    {
        Preferences.Default.Clear();
        return Task.FromResult(new PreferencesClearResult(true));
    }
}
