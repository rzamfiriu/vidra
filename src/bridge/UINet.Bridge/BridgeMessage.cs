using System.Text.Json;
using System.Text.Json.Serialization;

namespace UINet.Bridge;

/// <summary>
/// JSON envelope sent from JS to C#.
/// Example: { "id": "abc-123", "module": "filesystem", "method": "readText", "payload": { "path": "/tmp/f.txt" } }
/// </summary>
public sealed class BridgeRequest
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("module")]
    public required string Module { get; init; }

    [JsonPropertyName("method")]
    public required string Method { get; init; }

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
/// Example: { "event": "app.resume", "data": { } }
/// </summary>
public sealed class BridgeEvent
{
    [JsonPropertyName("event")]
    public required string Event { get; init; }

    [JsonPropertyName("data")]
    public object? Data { get; init; }
}

/// <summary>
/// JSON envelope sent from C# to JS for reverse RPC calls.
/// </summary>
public sealed class ReverseRequest
{
    [JsonPropertyName("id")]
    public required string Id { get; init; }

    [JsonPropertyName("handler")]
    public required string Handler { get; init; }

    [JsonPropertyName("payload")]
    public object? Payload { get; init; }
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
