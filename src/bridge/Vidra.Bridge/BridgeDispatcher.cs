using System.Text.Json;

namespace Vidra.Bridge;

/// <summary>
/// Routes incoming JS messages to the correct <see cref="IBridgeModule"/>
/// and serializes the response back.
/// </summary>
public sealed class BridgeDispatcher
{
    private readonly Dictionary<string, IBridgeModule> _modules = new(StringComparer.OrdinalIgnoreCase);

    public void Register(IBridgeModule module)
    {
        _modules[module.ModuleName] = module;
    }

    /// <summary>
    /// The registered modules, exposed so the host can wire cross-cutting
    /// concerns such as attaching the JS callback channel to every
    /// <see cref="IBridgeEventSource"/>.
    /// </summary>
    public IReadOnlyCollection<IBridgeModule> Modules => _modules.Values.ToList();

    public IReadOnlyDictionary<string, IReadOnlyList<string>> GetCapabilities()
    {
        var caps = new Dictionary<string, IReadOnlyList<string>>();
        foreach (var (name, module) in _modules)
            caps[name] = module.SupportedMethods;
        return caps;
    }

    /// <summary>
    /// Receive a raw JSON string from the WebView, dispatch it, and return a JSON response string.
    /// </summary>
    public async Task<string> DispatchAsync(string rawJson, CancellationToken ct = default)
    {
        BridgeRequest? request;
        try
        {
            request = JsonSerializer.Deserialize<BridgeRequest>(rawJson, BridgeSerializer.Default);
        }
        catch (JsonException ex)
        {
            return BridgeSerializer.Serialize(new BridgeResponse
            {
                Id = "unknown",
                Success = false,
                Error = new BridgeError { Code = "PARSE_ERROR", Message = ex.Message },
            });
        }

        if (request is null)
        {
            return BridgeSerializer.Serialize(new BridgeResponse
            {
                Id = "unknown",
                Success = false,
                Error = new BridgeError { Code = "PARSE_ERROR", Message = "Request was null." },
            });
        }

        if (request.Module == "__bridge" && request.Method == "capabilities")
        {
            return BridgeSerializer.Serialize(new BridgeResponse
            {
                Id = request.Id,
                Success = true,
                Data = GetCapabilities(),
            });
        }

        if (!_modules.TryGetValue(request.Module, out var module))
        {
            return BridgeSerializer.Serialize(new BridgeResponse
            {
                Id = request.Id,
                Success = false,
                Error = new BridgeError { Code = "MODULE_NOT_FOUND", Message = $"No module '{request.Module}' is registered." },
            });
        }

        try
        {
            var payload = request.Payload.HasValue ? new JsonPayload(request.Payload.Value) : null;
            var result = await module.HandleAsync(request.Method, payload, ct);

            return BridgeSerializer.Serialize(new BridgeResponse
            {
                Id = request.Id,
                Success = true,
                Data = result,
            });
        }
        catch (Exception ex)
        {
            return BridgeSerializer.Serialize(new BridgeResponse
            {
                Id = request.Id,
                Success = false,
                Error = new BridgeError { Code = "MODULE_ERROR", Message = ex.Message },
            });
        }
    }
}
