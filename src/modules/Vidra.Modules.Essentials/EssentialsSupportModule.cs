using Microsoft.Maui.ApplicationModel.Communication;
using Microsoft.Maui.Devices;
using Microsoft.Maui.Media;
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
    public async Task<EssentialsSupport> GetSupportAsync(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var textToSpeechSupported = true;
#if ANDROID
        try
        {
            textToSpeechSupported = (await TextToSpeech.Default.GetLocalesAsync()).Any();
        }
        catch
        {
            textToSpeechSupported = false;
        }
#endif

        var support = EssentialsSupportFactory.Create(
            DeviceInfo.Current.Platform.ToString(),
            Email.Default.IsComposeSupported,
            textToSpeechSupported);
        return support;
    }
}
