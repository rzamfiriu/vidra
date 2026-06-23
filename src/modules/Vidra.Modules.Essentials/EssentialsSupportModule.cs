using Microsoft.Maui.ApplicationModel.Communication;
using Microsoft.Maui.Devices;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

/// <summary>
/// Meta module exposing <c>essentials.getSupport()</c> so the JS layer can
/// query which Essentials capabilities work on the current platform.
/// </summary>
[BridgeModule("essentials")]
public sealed class EssentialsSupportModule : BridgeModuleBase
{
    [BridgeMethod("getSupport")]
    public Task<EssentialsSupport> GetSupportAsync(CancellationToken ct)
    {
        var support = EssentialsSupportFactory.Create(
            DeviceInfo.Current.Platform.ToString(),
            Email.Default.IsComposeSupported);
        return Task.FromResult(support);
    }
}
