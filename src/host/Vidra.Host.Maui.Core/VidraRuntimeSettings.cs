namespace Vidra.Hosting;

/// <summary>
/// Reads process-level runtime overrides supplied by the desktop environment or
/// by an Android debug launch intent.
/// </summary>
public static partial class VidraRuntimeSettings
{
    public const string DevUrl = "VIDRA_DEV_URL";

    private static IReadOnlyDictionary<string, string> _overrides =
        new Dictionary<string, string>(StringComparer.Ordinal);

    /// <summary>Returns an Android launch override first, then the process environment.</summary>
    public static string? Get(string name)
    {
        var overrides = Volatile.Read(ref _overrides);
        return overrides.TryGetValue(name, out var value)
            ? value
            : Environment.GetEnvironmentVariable(name);
    }

    /// <summary>
    /// Replaces process-level launch overrides. Android calls this once, before
    /// MAUI creates the application; replacing the immutable snapshot also makes
    /// activity recreation deterministic.
    /// </summary>
    private static void ApplyOverrides(IEnumerable<KeyValuePair<string, string?>> values)
    {
        var next = values
            .Where(pair => pair.Key.StartsWith("VIDRA_", StringComparison.Ordinal)
                && !string.IsNullOrWhiteSpace(pair.Value))
            .ToDictionary(
                pair => pair.Key,
                pair => pair.Value!.Trim(),
                StringComparer.Ordinal);

        Volatile.Write(ref _overrides, next);
    }
}
