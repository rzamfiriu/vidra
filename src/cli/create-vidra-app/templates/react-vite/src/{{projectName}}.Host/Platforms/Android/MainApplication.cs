using Android.App;
using Android.Runtime;

namespace {{projectName}};

#if DEBUG
[Application(UsesCleartextTraffic = true)]
#elif VIDRA_ANDROID_TEST_RUNTIME
[Application(Debuggable = true, UsesCleartextTraffic = true)]
#else
[Application]
#endif
public class MainApplication(nint handle, JniHandleOwnership ownership)
    : MauiApplication(handle, ownership)
{
    protected override MauiApp CreateMauiApp() => MauiProgram.CreateMauiApp();
}
