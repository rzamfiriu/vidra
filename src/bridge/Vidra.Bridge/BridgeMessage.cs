using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vidra.Bridge;

/// <summary>
/// JSON envelope sent from JS to C#.
/// Example: { "id": "abc-123", "contract": "filesystem", "member": "readText", "payload": { "path": "/tmp/f.txt" } }
/// </summary>
public sealed class BridgeRequest
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("contract")]
    public required string Contract { get; init; }

    [JsonPropertyName("member")]
    public required string Member { get; init; }

    [JsonPropertyName("payload")]
    public JsonElement? Payload { get; init; }
}

/// <summary>
/// JSON envelope sent from C# back to JS.
/// </summary>
public sealed class BridgeResponse
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("success")]
    public required bool Success { get; init; }

    [JsonPropertyName("data")]
    public object? Data { get; init; }

    [JsonPropertyName("error")]
    public BridgeError? Error { get; init; }
}

public sealed class BridgeError
{
    [JsonPropertyName("code")]
    public required string Code { get; init; }

    [JsonPropertyName("message")]
    public required string Message { get; init; }
}

/// <summary>
/// JSON envelope for events pushed from C# to JS.
/// Example: { "contract": "connectivity", "member": "changed", "payload": { } }
/// </summary>
public sealed class BridgeEvent
{
    [JsonPropertyName("contract")]
    public required string Contract { get; init; }

    [JsonPropertyName("member")]
    public required string Member { get; init; }

    [JsonPropertyName("payload")]
    public JsonElement? Payload { get; init; }
}

/// <summary>
/// JSON envelope sent from C# to JS for reverse RPC calls.
/// </summary>
public sealed class ReverseRequest
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("contract")]
    public required string Contract { get; init; }

    [JsonPropertyName("member")]
    public required string Member { get; init; }

    [JsonPropertyName("payload")]
    public JsonElement? Payload { get; init; }
}

/// <summary>
/// JSON envelope sent from JS back to C# with the reverse RPC result.
/// </summary>
public sealed class ReverseResponse
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("success")]
    public required bool Success { get; init; }

    [JsonPropertyName("data")]
    public JsonElement? Data { get; init; }

    [JsonPropertyName("error")]
    public BridgeError? Error { get; init; }
}

public sealed class BridgeHandshake
{
    [JsonPropertyName("protocolVersion")]
    public required int ProtocolVersion { get; init; }

    [JsonPropertyName("coreFingerprint")]
    public required string CoreFingerprint { get; init; }

    [JsonPropertyName("appFingerprint")]
    public required string AppFingerprint { get; init; }
}

public sealed class BridgeCapabilities
{
    [JsonPropertyName("protocolVersion")]
    public required int ProtocolVersion { get; init; }

    [JsonPropertyName("nativeContracts")]
    public Dictionary<string, NativeContractCapabilities> NativeContracts { get; init; } = new();
}

public sealed class NativeContractCapabilities
{
    [JsonPropertyName("methods")]
    public IReadOnlyList<string> Methods { get; init; } = Array.Empty<string>();

    [JsonPropertyName("events")]
    public IReadOnlyList<string> Events { get; init; } = Array.Empty<string>();
}
