namespace Vidra.Hosting;

internal static class BridgeFileSystemRoots
{
    public static string Resolve(string root)
        => root switch
        {
            "appData" => Microsoft.Maui.Storage.FileSystem.Current.AppDataDirectory,
            "cache" => Microsoft.Maui.Storage.FileSystem.Current.CacheDirectory,
#if ANDROID
            "documents" => AppScopedDirectory("documents"),
            "downloads" => AppScopedDirectory("downloads"),
#elif IOS
            // MyDocuments is the app container's own Documents folder on iOS.
            // There is no Downloads folder inside the sandbox.
            "documents" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "downloads" => AppScopedDirectory("downloads"),
#else
            "documents" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "downloads" => Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                "Downloads"),
#endif
            _ => throw new InvalidOperationException(
                $"Unknown filesystem root '{root}'."),
        };

#if ANDROID || IOS
    private static string AppScopedDirectory(string name)
    {
        var path = Path.Combine(
            Microsoft.Maui.Storage.FileSystem.Current.AppDataDirectory,
            name);
        Directory.CreateDirectory(path);
        return path;
    }
#endif
}
