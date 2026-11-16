// The app's entry point on iOS. Unlike the desktop entry points it has no
// VelopackApp line: the App Store owns app updates here, and only the web-bundle
// tier runs.

using UIKit;

namespace {{projectName}};

public static class Program
{
    static void Main(string[] args)
    {
        UIApplication.Main(args, null, typeof(AppDelegate));
    }
}
