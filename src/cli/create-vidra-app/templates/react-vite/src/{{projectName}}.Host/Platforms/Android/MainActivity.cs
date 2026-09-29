using Android.App;
using Android.Content.PM;
using Android.OS;
using Vidra.Hosting;

namespace {{projectName}};

[Activity(
    Theme = "@style/Maui.SplashTheme",
    MainLauncher = true,
    LaunchMode = LaunchMode.SingleTop,
    ConfigurationChanges = ConfigChanges.ScreenSize
        | ConfigChanges.Orientation
        | ConfigChanges.UiMode
        | ConfigChanges.ScreenLayout
        | ConfigChanges.SmallestScreenSize
        | ConfigChanges.Density)]
public class MainActivity : MauiAppCompatActivity
{
    protected override void OnCreate(Bundle? savedInstanceState)
    {
        ApplyDebugLaunchOverrides(Intent);
        base.OnCreate(savedInstanceState);
    }

    protected override void OnNewIntent(Android.Content.Intent? intent)
    {
        base.OnNewIntent(intent);
        ApplyDebugLaunchOverrides(intent);
    }

    private void ApplyDebugLaunchOverrides(Android.Content.Intent? intent)
    {
        if ((ApplicationInfo?.Flags & ApplicationInfoFlags.Debuggable) != 0)
            VidraRuntimeSettings.ApplyAndroidIntentExtras(intent);
    }
}
