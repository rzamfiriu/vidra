using Microsoft.Maui.Hosting;

namespace Vidra.Hosting;

/// <summary>
/// Drives the updater at the only moment that works: while MAUI is still
/// building the app, before <c>Application</c> is constructed and long before
/// <c>VidraPage</c> asks what to load.
/// </summary>
internal sealed class VidraUpdateStartup(VidraUpdateService updates) : IMauiInitializeService
{
    public void Initialize(IServiceProvider services)
    {
#if !ANDROID
        updates.StartAtLaunch();
#else
        _ = updates;
#endif
    }
}
