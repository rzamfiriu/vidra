using System.Text.Json;

namespace Vidra.Bridge;

/// <summary>
/// Thin wrapper around a raw JSON element received from the JS layer.
/// Provides typed deserialization helpers without coupling modules to parsing details.
/// </summary>
public sealed class JsonPayload
{
    private readonly JsonElement _element;

    public JsonPayload(JsonElement element) => _element = element;

    public T? Deserialize<T>(JsonSerializerOptions? options = null)
        => _element.Deserialize<T>(options ?? BridgeSerializer.Default);

    public object? Deserialize(Type type, JsonSerializerOptions? options = null)
        => _element.Deserialize(type, options ?? BridgeSerializer.Default);

    public JsonElement Raw => _element;

    public override string ToString() => _element.GetRawText();
}
