namespace UINet.Bridge;

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
