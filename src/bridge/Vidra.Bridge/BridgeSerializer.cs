using System.Text.Json;
using System.Text.Json.Serialization;

namespace Vidra.Bridge;

public static class BridgeSerializer
{
    public static readonly JsonSerializerOptions Default = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    public static string Serialize<T>(T value)
        => JsonSerializer.Serialize(value, Default);

    public static T? Deserialize<T>(string json)
        => JsonSerializer.Deserialize<T>(json, Default);
}
