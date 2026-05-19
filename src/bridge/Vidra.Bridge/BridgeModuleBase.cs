using System.Reflection;

namespace Vidra.Bridge;

/// <summary>
/// Base class for attribute-driven bridge modules. Automatically implements
/// <see cref="IBridgeModule"/> by reflecting over <see cref="BridgeMethodAttribute"/>
/// decorated methods. Module authors inherit from this and write attributed methods.
/// </summary>
public abstract class BridgeModuleBase : IBridgeModule
{
    private readonly string _moduleName;
    private readonly Dictionary<string, MethodInfo> _methods;

    protected BridgeModuleBase()
    {
        var moduleAttr = GetType().GetCustomAttribute<BridgeModuleAttribute>()
            ?? throw new InvalidOperationException(
                $"{GetType().Name} must be decorated with [BridgeModule(\"name\")].");

        _moduleName = moduleAttr.Name;

        _methods = GetType()
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Select(m => (method: m, attr: m.GetCustomAttribute<BridgeMethodAttribute>()))
            .Where(pair => pair.attr is not null)
            .ToDictionary(pair => pair.attr!.Name, pair => pair.method, StringComparer.OrdinalIgnoreCase);
    }

    public string ModuleName => _moduleName;

    public IReadOnlyList<string> SupportedMethods => _methods.Keys.ToList();

    public async Task<object?> HandleAsync(string method, JsonPayload? payload, CancellationToken ct)
    {
        if (!_methods.TryGetValue(method, out var methodInfo))
            throw new NotSupportedException($"Method '{method}' is not supported by {_moduleName}.");

        var parameters = methodInfo.GetParameters();
        var args = BuildArguments(parameters, payload, ct);
        var result = methodInfo.Invoke(this, args);

        if (result is Task task)
        {
            await task.ConfigureAwait(false);
            // Extract the result from Task<T> if it's a generic task
            var taskType = task.GetType();
            if (taskType.IsGenericType)
            {
                return taskType.GetProperty("Result")!.GetValue(task);
            }
            return null;
        }

        return result;
    }

    private static object?[] BuildArguments(ParameterInfo[] parameters, JsonPayload? payload, CancellationToken ct)
    {
        var args = new object?[parameters.Length];

        for (var i = 0; i < parameters.Length; i++)
        {
            var param = parameters[i];

            if (param.ParameterType == typeof(CancellationToken))
            {
                args[i] = ct;
            }
            else if (payload is not null)
            {
                args[i] = payload.Deserialize(param.ParameterType);
            }
            else
            {
                args[i] = param.HasDefaultValue ? param.DefaultValue : null;
            }
        }

        return args;
    }
}
