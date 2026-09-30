#if ANDROID
using Android.Content;

namespace Vidra.Hosting;

public static partial class VidraRuntimeSettings
{
    /// <summary>
    /// Imports string extras from a debuggable app's launch intent. Entry points
    /// guard this call with the manifest's debuggable flag, so another
    /// application cannot override asset or update sources in a shipped build.
    /// </summary>
    public static void ApplyAndroidIntentExtras(Intent? intent)
    {
        var extras = intent?.Extras;
        if (extras is null)
        {
            ApplyOverrides([]);
            return;
        }

        var values = extras.KeySet()!
            .Select(key => new KeyValuePair<string, string?>(key, extras.GetString(key)));
        ApplyOverrides(values);
    }
}
#endif
