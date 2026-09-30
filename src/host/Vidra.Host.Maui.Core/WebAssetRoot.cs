namespace Vidra.Hosting;

/// <summary>
/// Decides which directory a production WebView serves its web assets from.
/// </summary>
/// <remarks>
/// The embedded copy (<c>Resources/Raw/wwwroot</c>) is the floor: it always
/// ships, it is never written to, and it is what loads when no external root
/// resolves. An external root is only honoured when it exists and actually
/// contains an <c>index.html</c>, so a half-extracted or hand-deleted directory
/// degrades to the embedded copy instead of a blank window.
/// </remarks>
public static class WebAssetRoot
{
    /// <summary>
    /// Directory to serve instead of the embedded copy. Read at WebView load
    /// time, so an in-process update client can set it before the first page
    /// loads.
    /// </summary>
    public const string EnvironmentVariable = "VIDRA_ASSET_ROOT";

    /// <summary>
    /// Selects the mechanism used to serve an external root on Windows —
    /// <c>virtualhost</c> (default, a <c>https://</c> virtual host mapped to the
    /// folder) or <c>file</c> (a plain <c>file://</c> URL).
    /// </summary>
    public const string WindowsModeEnvironmentVariable = "VIDRA_ASSET_ROOT_MODE";

    private static Func<string?>? _resolver;

    /// <summary>
    /// Installs the source of truth for which directory serves — in practice the
    /// update client, which has already decided by reading
    /// <c>vidra/bundles/state.json</c> before the WebView exists. Pass
    /// <see langword="null"/> to go back to the embedded copy.
    /// </summary>
    internal static void UseResolver(Func<string?>? resolver) => _resolver = resolver;

    /// <summary>
    /// Returns a validated external asset directory, or <see langword="null"/>
    /// when the embedded copy should be used.
    /// </summary>
    public static string? Resolve()
    {
        // The environment variable outranks the resolver so a developer or a test
        // can pin a directory without going through an update at all.
        var fromEnvironment = VidraRuntimeSettings.Get(EnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(fromEnvironment))
            return Validate(fromEnvironment, EnvironmentVariable);

        try
        {
            var fromResolver = _resolver?.Invoke();
            return string.IsNullOrWhiteSpace(fromResolver) ? null : Validate(fromResolver, "the update client");
        }
        catch (Exception ex)
        {
            // A resolver that throws must not take the window with it.
            Console.WriteLine($"[vidra] asset resolver failed ({ex.Message}); using the embedded copy");
            return null;
        }
    }

    private static string? Validate(string candidate, string source)
    {
        try
        {
            var full = Path.GetFullPath(candidate);
            if (File.Exists(Path.Combine(full, "index.html")))
                return full;

            Console.WriteLine($"[vidra] asset root '{full}' from {source} has no index.html; using the embedded copy");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[vidra] asset root '{candidate}' from {source} is unusable ({ex.Message}); using the embedded copy");
        }

        return null;
    }

    /// <summary>True when the Windows leg should serve the root over file://.</summary>
    internal static bool PreferFileUrlOnWindows()
        => string.Equals(
            VidraRuntimeSettings.Get(WindowsModeEnvironmentVariable),
            "file",
            StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Announces the resolved source on stdout. Asset resolution is the first
    /// thing to suspect when a production window comes up blank, and a launched
    /// app has no other way to say where it read from.
    /// </summary>
    internal static void Announce(string root, bool external, string mechanism)
        => Console.WriteLine(
            $"[vidra] web assets: {(external ? "external" : "embedded")} via {mechanism} — {root}");
}
