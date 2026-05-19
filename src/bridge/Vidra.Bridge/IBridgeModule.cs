namespace Vidra.Bridge;

/// <summary>
/// A native module that exposes one or more capabilities to the JS layer.
/// Modules are registered at startup and matched by <see cref="ModuleName"/>.
/// </summary>
public interface IBridgeModule
{
    string ModuleName { get; }

    /// <summary>
    /// Returns the list of method names this module handles.
    /// </summary>
    IReadOnlyList<string> SupportedMethods { get; }

    /// <summary>
    /// Handle an incoming request from JS and return a result or throw.
    /// </summary>
    Task<object?> HandleAsync(string method, JsonPayload? payload, CancellationToken ct);
}
