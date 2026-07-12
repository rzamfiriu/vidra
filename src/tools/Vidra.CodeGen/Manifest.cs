using System.Text.Json.Serialization;

namespace Vidra.CodeGen;

public sealed class Manifest
{
    [JsonPropertyName("contracts")]
    public Dictionary<string, ContractManifest> Contracts { get; init; } = new();

    [JsonPropertyName("fingerprint")]
    public string Fingerprint { get; set; } = string.Empty;

    [JsonIgnore]
    public string CanonicalManifest { get; set; } = string.Empty;
}

public sealed class ContractManifest
{
    [JsonPropertyName("className")]
    public string? ClassName { get; set; }

    [JsonPropertyName("nativeMethods")]
    public Dictionary<string, MethodManifest> NativeMethods { get; init; } = new();

    [JsonPropertyName("events")]
    public Dictionary<string, EventManifest> Events { get; init; } = new();

    [JsonPropertyName("jsMethods")]
    public Dictionary<string, MethodManifest> JsMethods { get; init; } = new();
}

public sealed class MethodManifest
{
    [JsonPropertyName("params")]
    public TypeRef? Params { get; init; }

    [JsonPropertyName("returns")]
    public TypeRef? Returns { get; init; }
}

public sealed class EventManifest
{
    [JsonPropertyName("payload")]
    public TypeRef? Payload { get; init; }
}

/// <summary>
/// Describes a type that maps to a TS type. Can be a primitive, an object with fields, an array, etc.
/// </summary>
public sealed class TypeRef
{
    [JsonPropertyName("kind")]
    public required string Kind { get; init; } // "primitive", "object", "array", "nullable", "dictionary", "enum"

    [JsonPropertyName("tsType")]
    public string? TsType { get; init; } // for primitives: "string", "number", "boolean"

    [JsonPropertyName("name")]
    public string? Name { get; init; } // for records/enums: the C# type name

    [JsonPropertyName("fields")]
    public Dictionary<string, TypeRef>? Fields { get; init; } // for object/record types

    [JsonPropertyName("element")]
    public TypeRef? Element { get; init; } // for arrays and nullable

    [JsonPropertyName("values")]
    public List<string>? Values { get; init; } // for enums
}
