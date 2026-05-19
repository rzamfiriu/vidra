using System.Text.Json.Serialization;

namespace Vidra.CodeGen;

public sealed class Manifest
{
    [JsonPropertyName("modules")]
    public Dictionary<string, ModuleManifest> Modules { get; init; } = new();
}

public sealed class ModuleManifest
{
    [JsonPropertyName("className")]
    public required string ClassName { get; init; }

    [JsonPropertyName("methods")]
    public Dictionary<string, MethodManifest> Methods { get; init; } = new();
}

public sealed class MethodManifest
{
    [JsonPropertyName("params")]
    public TypeRef? Params { get; init; }

    [JsonPropertyName("returns")]
    public TypeRef? Returns { get; init; }
}

/// <summary>
/// Describes a type that maps to a TS type. Can be a primitive, an object with fields, an array, etc.
/// </summary>
public sealed class TypeRef
{
    [JsonPropertyName("kind")]
    public required string Kind { get; init; } // "primitive", "object", "array", "nullable", "record", "enum"

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
