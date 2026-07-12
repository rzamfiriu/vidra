using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Vidra.Bridge;

/// <summary>A strongly typed identifier for an event with no payload.</summary>
public readonly record struct BridgeEventToken(string Contract, string Member);

/// <summary>A strongly typed identifier and serializer for an event payload.</summary>
public readonly record struct BridgeEventToken<TPayload>(
    string Contract,
    string Member,
    Func<TPayload, JsonElement> SerializePayload);

/// <summary>A strongly typed identifier for a JavaScript method with no payload or result.</summary>
public readonly record struct JsMethodToken(string Contract, string Member);

/// <summary>A strongly typed identifier for a JavaScript method with a result.</summary>
public readonly record struct JsMethodToken<TResult>(
    string Contract,
    string Member,
    Func<JsonElement, TResult> DeserializeResult);

/// <summary>A strongly typed identifier for a JavaScript method with a payload.</summary>
public readonly record struct JsMethodPayloadToken<TPayload>(
    string Contract,
    string Member,
    Func<TPayload, JsonElement> SerializePayload);

/// <summary>A strongly typed identifier and serializers for a JavaScript method.</summary>
public readonly record struct JsMethodToken<TPayload, TResult>(
    string Contract,
    string Member,
    Func<TPayload, JsonElement> SerializePayload,
    Func<JsonElement, TResult> DeserializeResult);

/// <summary>Runtime settings for the Vidra bridge.</summary>
public sealed class VidraBridgeOptions
{
    public TimeSpan JsContractTimeout { get; set; } = TimeSpan.FromSeconds(30);
}

/// <summary>An error returned by a JavaScript contract member.</summary>
public sealed class JsRemoteException(string code, string message)
    : Exception($"[{code}] {message}")
{
    public string Code { get; } = code;
}

/// <summary>A JavaScript contract member did not respond before the configured deadline.</summary>
public sealed class JsContractTimeoutException(string contract, string member, TimeSpan timeout)
    : TimeoutException($"JavaScript contract '{contract}.{member}' did not respond within {timeout}.")
{
    public string Contract { get; } = contract;
    public string Member { get; } = member;
    public TimeSpan Timeout { get; } = timeout;
}

public enum BridgeManifestScope
{
    Core,
    App,
}

/// <summary>Protocol constants shared by the host and generated clients.</summary>
public static class BridgeProtocol
{
    public const int Version = 2;
}

/// <summary>
/// Process-wide registry of immutable generated contract manifests.
/// Generated module initializers register one fingerprint per contract assembly.
/// </summary>
public static class BridgeContractRegistry
{
    private static readonly ConcurrentDictionary<string, (BridgeManifestScope Scope, string CanonicalManifest)> Components =
        new(StringComparer.Ordinal);

    public static void Register(
        string component,
        BridgeManifestScope scope,
        string canonicalManifest)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(component);
        ArgumentNullException.ThrowIfNull(canonicalManifest);

        if (Components.TryAdd(component, (scope, canonicalManifest)))
            return;

        var existing = Components[component];
        if (existing.Scope == scope
            && string.Equals(existing.CanonicalManifest, canonicalManifest, StringComparison.Ordinal))
        {
            return;
        }

        // Plugin load contexts can share Vidra.Bridge while loading incompatible
        // assemblies with the same simple name; accepting the second descriptor
        // would make startup fingerprints depend on load order.
        throw new InvalidOperationException(
            $"Bridge contract component '{component}' is already registered with different metadata.");
    }

    public static string Fingerprint(BridgeManifestScope scope)
    {
        var canonical = CanonicalManifest(scope);

        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    public static string CanonicalManifest(BridgeManifestScope scope)
        => string.Join(
            "\n",
            Components
                .Where(component => component.Value.Scope == scope)
                .SelectMany(component => component.Value.CanonicalManifest
                    .Split(['\n'], StringSplitOptions.RemoveEmptyEntries))
                .OrderBy(entry => EntryPart(entry, 0), StringComparer.Ordinal)
                .ThenBy(entry => KindRank(EntryPart(entry, 1)))
                .ThenBy(entry => EntryPart(entry, 2), StringComparer.Ordinal));

    private static string EntryPart(string entry, int index)
    {
        var parts = entry.Split('|');
        return parts.Length > index ? parts[index] : string.Empty;
    }

    private static int KindRank(string kind)
        => kind switch
        {
            "NativeMethod" => 0,
            "Event" => 1,
            "JsMethod" => 2,
            _ => int.MaxValue,
        };
}
