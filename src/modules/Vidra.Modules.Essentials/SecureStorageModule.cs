using Microsoft.Maui.Storage;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public record SecureStorageGetArgs(string Key);
public record SecureStorageGetResult(string? Value);

public record SecureStorageSetArgs(string Key, string Value);
public record SecureStorageSetResult(bool Success);

public record SecureStorageRemoveArgs(string Key);
public record SecureStorageRemoveResult(bool Removed);

public record SecureStorageRemoveAllResult(bool Success);

/// <summary>
/// Wraps MAUI Essentials <see cref="SecureStorage"/> (Keychain on Apple platforms,
/// Credential Locker / DPAPI on Windows). Values are stored encrypted at rest.
/// </summary>
[BridgeModule("secureStorage")]
public sealed class SecureStorageModule : BridgeModuleBase
{
    [BridgeMethod("get")]
    public async Task<SecureStorageGetResult> GetAsync(SecureStorageGetArgs args, CancellationToken ct)
    {
        var value = await SecureStorage.Default.GetAsync(args.Key);
        return new SecureStorageGetResult(value);
    }

    [BridgeMethod("set")]
    public async Task<SecureStorageSetResult> SetAsync(SecureStorageSetArgs args, CancellationToken ct)
    {
        await SecureStorage.Default.SetAsync(args.Key, args.Value);
        return new SecureStorageSetResult(true);
    }

    [BridgeMethod("remove")]
    public Task<SecureStorageRemoveResult> RemoveAsync(SecureStorageRemoveArgs args, CancellationToken ct)
    {
        var removed = SecureStorage.Default.Remove(args.Key);
        return Task.FromResult(new SecureStorageRemoveResult(removed));
    }

    [BridgeMethod("removeAll")]
    public Task<SecureStorageRemoveAllResult> RemoveAllAsync(CancellationToken ct)
    {
        SecureStorage.Default.RemoveAll();
        return Task.FromResult(new SecureStorageRemoveAllResult(true));
    }
}
