namespace Vidra.Bridge;

/// <summary>
/// Marks a class as a bridge module accessible from the JS layer.
/// The <paramref name="name"/> is the module identifier used in JS calls.
/// </summary>
[AttributeUsage(AttributeTargets.Class, Inherited = false)]
public sealed class BridgeModuleAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

/// <summary>
/// Marks a method on a bridge module as callable from the JS layer.
/// The <paramref name="name"/> is the method identifier used in JS calls.
/// </summary>
[AttributeUsage(AttributeTargets.Method, Inherited = false)]
public sealed class BridgeMethodAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

/// <summary>
/// Marks an interface as the source of truth for events emitted by C#.
/// Members must return <see langword="void"/> and accept zero or one payload parameter.
/// </summary>
[AttributeUsage(AttributeTargets.Interface, Inherited = false)]
public sealed class BridgeEventContractAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

/// <summary>
/// Marks a member of a <see cref="BridgeEventContractAttribute"/> interface as an event.
/// </summary>
[AttributeUsage(AttributeTargets.Method, Inherited = false)]
public sealed class BridgeEventAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

/// <summary>
/// Marks an interface as a JavaScript-implemented contract callable from C#.
/// </summary>
[AttributeUsage(AttributeTargets.Interface, Inherited = false)]
public sealed class JsContractAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}

/// <summary>
/// Marks a member of a <see cref="JsContractAttribute"/> interface as callable in JavaScript.
/// </summary>
[AttributeUsage(AttributeTargets.Method, Inherited = false)]
public sealed class JsMethodAttribute(string name) : Attribute
{
    public string Name { get; } = name;
}
