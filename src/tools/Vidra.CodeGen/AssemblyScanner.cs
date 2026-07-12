using System.Reflection;
using Vidra.CodeGen.Model;

namespace Vidra.CodeGen;

/// <summary>
/// Scans compiled assemblies via MetadataLoadContext to extract module/method metadata
/// without requiring the MAUI runtime.
/// </summary>
public sealed class AssemblyScanner
{
    private readonly MetadataLoadContext _mlc;

    public AssemblyScanner(string[] assemblyPaths)
    {
        // Collect all .dll files from the directories of input assemblies
        // so that transitive references (like Vidra.Bridge) are resolvable.
        var dirs = assemblyPaths
            .Select(p => Path.GetDirectoryName(Path.GetFullPath(p))!)
            .Distinct();
        var siblingDlls = dirs.SelectMany(d => Directory.GetFiles(d, "*.dll"));

        // Deduplicate by filename: runtime assemblies take priority over
        // platform-specific copies to avoid MetadataLoadContext conflicts.
        var byName = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in GetRuntimeAssemblies())
            byName[Path.GetFileName(path)] = path;
        foreach (var path in siblingDlls)
            byName.TryAdd(Path.GetFileName(path), path);
        foreach (var path in assemblyPaths)
            byName[Path.GetFileName(path)] = Path.GetFullPath(path);

        var resolver = new PathAssemblyResolver(byName.Values);
        _mlc = new MetadataLoadContext(resolver);
    }

    public Manifest Scan(string[] assemblyPaths)
    {
        var manifest = new Manifest();

        foreach (var path in assemblyPaths)
        {
            var assembly = _mlc.LoadFromAssemblyPath(Path.GetFullPath(path));
            foreach (var type in assembly.GetExportedTypes())
            {
                var moduleAttr = type.CustomAttributes
                    .FirstOrDefault(a => a.AttributeType.Name == "BridgeModuleAttribute");
                var eventAttr = type.CustomAttributes
                    .FirstOrDefault(a => a.AttributeType.Name == "BridgeEventContractAttribute");
                var jsAttr = type.CustomAttributes
                    .FirstOrDefault(a => a.AttributeType.Name == "JsContractAttribute");

                if (moduleAttr is not null)
                {
                    var contractName = AttributeName(moduleAttr);
                    var contract = GetOrAddContract(manifest, contractName);
                    if (contract.ClassName is not null)
                        throw new InvalidOperationException($"Duplicate native contract '{contractName}'.");
                    contract.ClassName = type.Name;
                    foreach (var (name, method) in ScanNativeMethods(type))
                        contract.NativeMethods.Add(name, method);
                }
                else if (eventAttr is not null)
                {
                    var contractName = AttributeName(eventAttr);
                    var contract = GetOrAddContract(manifest, contractName);
                    foreach (var (name, bridgeEvent) in ScanEvents(type))
                        contract.Events.Add(name, bridgeEvent);
                }
                else if (jsAttr is not null)
                {
                    var contractName = AttributeName(jsAttr);
                    var contract = GetOrAddContract(manifest, contractName);
                    foreach (var (name, method) in ScanJsMethods(type))
                        contract.JsMethods.Add(name, method);
                }
            }
        }

        var entries = ToContractEntries(manifest).ToArray();
        manifest.CanonicalManifest = ContractFingerprint.Canonicalize(entries);
        manifest.Fingerprint = ContractFingerprint.Compute(entries);
        return manifest;
    }

    private Dictionary<string, MethodManifest> ScanNativeMethods(Type type)
    {
        var methods = new Dictionary<string, MethodManifest>();

        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            var methodAttr = method.CustomAttributes
                .FirstOrDefault(a => a.AttributeType.Name == "BridgeMethodAttribute");

            if (methodAttr is null) continue;

            var methodName = (string)methodAttr.ConstructorArguments[0].Value!;
            var parameters = method.GetParameters();

            TypeRef? paramType = null;
            foreach (var param in parameters)
            {
                if (param.ParameterType.Name == "CancellationToken") continue;
                paramType = ResolveType(param.ParameterType);
                break; // only the first non-CT parameter is the payload
            }

            var returnType = UnwrapTaskType(method.ReturnType);
            TypeRef? returnRef = returnType is not null ? ResolveType(returnType) : null;

            methods[methodName] = new MethodManifest
            {
                Params = paramType,
                Returns = returnRef,
            };
        }

        return methods;
    }

    private Dictionary<string, EventManifest> ScanEvents(Type type)
    {
        if (!type.IsInterface)
            throw new InvalidOperationException($"Event contract '{type.FullName}' must be an interface.");

        var events = new Dictionary<string, EventManifest>(StringComparer.Ordinal);
        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            var attr = method.CustomAttributes
                .FirstOrDefault(a => a.AttributeType.Name == "BridgeEventAttribute");
            if (attr is null)
                continue;
            if (method.ReturnType.FullName != "System.Void")
                throw new InvalidOperationException($"Event member '{type.FullName}.{method.Name}' must return void.");

            var payloadParameters = method.GetParameters()
                .Where(parameter => parameter.ParameterType.FullName != "System.Threading.CancellationToken")
                .ToArray();
            if (payloadParameters.Length > 1)
                throw new InvalidOperationException($"Event member '{type.FullName}.{method.Name}' must have zero or one payload.");

            events.Add(AttributeName(attr), new EventManifest
            {
                Payload = payloadParameters.Length == 1 ? ResolveType(payloadParameters[0].ParameterType) : null,
            });
        }
        return events;
    }

    private Dictionary<string, MethodManifest> ScanJsMethods(Type type)
    {
        if (!type.IsInterface)
            throw new InvalidOperationException($"JS contract '{type.FullName}' must be an interface.");

        var methods = new Dictionary<string, MethodManifest>(StringComparer.Ordinal);
        foreach (var method in type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
        {
            var attr = method.CustomAttributes
                .FirstOrDefault(a => a.AttributeType.Name == "JsMethodAttribute");
            if (attr is null)
                continue;

            var payloadParameters = method.GetParameters()
                .Where(parameter => parameter.ParameterType.FullName != "System.Threading.CancellationToken")
                .ToArray();
            if (payloadParameters.Length > 1)
                throw new InvalidOperationException($"JS member '{type.FullName}.{method.Name}' must have zero or one payload.");

            if (method.ReturnType.Name != "Task" && method.ReturnType.Name != "Task`1")
                throw new InvalidOperationException($"JS member '{type.FullName}.{method.Name}' must return Task or Task<T>.");

            var returnType = UnwrapTaskType(method.ReturnType);
            methods.Add(AttributeName(attr), new MethodManifest
            {
                Params = payloadParameters.Length == 1 ? ResolveType(payloadParameters[0].ParameterType) : null,
                Returns = returnType is not null ? ResolveType(returnType) : null,
            });
        }
        return methods;
    }

    private static string AttributeName(CustomAttributeData attribute)
    {
        var name = attribute.ConstructorArguments.Count == 1
            ? attribute.ConstructorArguments[0].Value as string
            : null;
        return !string.IsNullOrWhiteSpace(name)
            ? name
            : throw new InvalidOperationException(
                $"{attribute.AttributeType.Name} requires an explicit non-empty name.");
    }

    private static ContractManifest GetOrAddContract(Manifest manifest, string contractName)
    {
        if (!manifest.Contracts.TryGetValue(contractName, out var contract))
        {
            contract = new ContractManifest();
            manifest.Contracts.Add(contractName, contract);
        }
        return contract;
    }

    private static IEnumerable<ContractEntry> ToContractEntries(Manifest manifest)
    {
        foreach (var (contractName, contract) in manifest.Contracts)
        {
            foreach (var (memberName, method) in contract.NativeMethods)
            {
                yield return new ContractEntry
                {
                    Contract = contractName,
                    Member = memberName,
                    Kind = ContractMemberKind.NativeMethod,
                    PayloadSchema = TypeSchema(method.Params),
                    ResultSchema = TypeSchema(method.Returns),
                };
            }
            foreach (var (memberName, bridgeEvent) in contract.Events)
            {
                yield return new ContractEntry
                {
                    Contract = contractName,
                    Member = memberName,
                    Kind = ContractMemberKind.Event,
                    PayloadSchema = TypeSchema(bridgeEvent.Payload),
                };
            }
            foreach (var (memberName, method) in contract.JsMethods)
            {
                yield return new ContractEntry
                {
                    Contract = contractName,
                    Member = memberName,
                    Kind = ContractMemberKind.JsMethod,
                    PayloadSchema = TypeSchema(method.Params),
                    ResultSchema = TypeSchema(method.Returns),
                };
            }
        }
    }

    private static string? TypeSchema(TypeRef? type)
    {
        if (type is null)
            return null;

        return type.Kind switch
        {
            "primitive" => $"primitive({type.TsType})",
            "nullable" => $"nullable({TypeSchema(type.Element)})",
            "array" => $"array({TypeSchema(type.Element)})",
            "dictionary" => $"dictionary({TypeSchema(type.Element)})",
            "enum" => $"enum({string.Join(",", type.Values ?? [])})",
            "object" => $"object({type.Name}){{{string.Join(",", (type.Fields ?? new())
                .OrderBy(field => field.Key, StringComparer.Ordinal)
                .Select(field => $"{field.Key}:{TypeSchema(field.Value)}"))}}}",
            _ => throw new InvalidOperationException($"Unsupported manifest type kind '{type.Kind}'."),
        };
    }

    private Type? UnwrapTaskType(Type type)
    {
        if (type.Name == "Task" && !type.IsGenericType)
            return null;

        if (type.IsGenericType && type.GetGenericTypeDefinition().Name == "Task`1")
            return type.GetGenericArguments()[0];

        return type;
    }

    private TypeRef ResolveType(Type type, HashSet<string>? visiting = null)
    {
        visiting ??= new HashSet<string>(StringComparer.Ordinal);

        // Nullable<T>
        if (type.IsGenericType && type.GetGenericTypeDefinition().FullName == "System.Nullable`1")
        {
            return new TypeRef
            {
                Kind = "nullable",
                Element = ResolveType(type.GetGenericArguments()[0], visiting),
            };
        }

        // Primitives
        var tsType = MapPrimitive(type);
        if (tsType is not null)
        {
            return new TypeRef { Kind = "primitive", TsType = tsType };
        }

        // Arrays
        if (type.IsArray)
        {
            return new TypeRef
            {
                Kind = "array",
                Element = ResolveType(type.GetElementType()!, visiting),
            };
        }

        // List<T>, IReadOnlyList<T>, IList<T>
        if (type.IsGenericType)
        {
            var genDef = type.GetGenericTypeDefinition();
            var genName = genDef.FullName ?? genDef.Name;
            if (genName.StartsWith("System.Collections.Generic.List`1") ||
                genName.StartsWith("System.Collections.Generic.IReadOnlyList`1") ||
                genName.StartsWith("System.Collections.Generic.IList`1"))
            {
                return new TypeRef
                {
                    Kind = "array",
                    Element = ResolveType(type.GetGenericArguments()[0], visiting),
                };
            }

            // Dictionary<string, T>
            if (genName.StartsWith("System.Collections.Generic.Dictionary`2") ||
                genName.StartsWith("System.Collections.Generic.IDictionary`2") ||
                genName.StartsWith("System.Collections.Generic.IReadOnlyDictionary`2"))
            {
                if (type.GetGenericArguments()[0].FullName != "System.String")
                    throw new InvalidOperationException(
                        $"Contract dictionary '{type.FullName}' must use string keys.");

                return new TypeRef
                {
                    Kind = "dictionary",
                    Element = ResolveType(type.GetGenericArguments()[1], visiting),
                };
            }
        }

        // Enum
        if (type.IsEnum)
        {
            var values = type.GetFields(BindingFlags.Public | BindingFlags.Static)
                .Select(f => f.Name)
                .ToList();
            return new TypeRef { Kind = "enum", Name = type.Name, Values = values };
        }

        // Record / Class with properties → object type
        var typeIdentity = type.FullName ?? type.Name;
        if (!visiting.Add(typeIdentity))
            throw new InvalidOperationException($"Cyclic contract type '{typeIdentity}' is not supported.");

        var properties = type.GetProperties(BindingFlags.Public | BindingFlags.Instance);
        if (properties.Length == 0)
            throw new InvalidOperationException(
                $"Contract type '{typeIdentity}' is unsupported because it has no public properties.");

        var hasMatchingConstructor = type.GetConstructors(BindingFlags.Public | BindingFlags.Instance)
            .Any(constructor =>
            {
                var parameters = constructor.GetParameters();
                return parameters.Length == properties.Length
                       && parameters.All(parameter =>
                           properties.Any(property =>
                               string.Equals(property.Name, parameter.Name, StringComparison.OrdinalIgnoreCase)
                               && property.PropertyType == parameter.ParameterType));
            });
        var hasSettableParameterlessShape =
            type.GetConstructor(Type.EmptyTypes) is not null
            && properties.All(property => property.SetMethod is not null);
        if (!hasMatchingConstructor && !hasSettableParameterlessShape)
        {
            throw new InvalidOperationException(
                $"Contract type '{typeIdentity}' needs a matching public constructor or settable properties.");
        }

        var fields = new Dictionary<string, TypeRef>();
        foreach (var prop in properties)
        {
            var fieldRef = ResolveType(prop.PropertyType, visiting);

            // Reference-type nullability (`string?`, `Foo?`) is carried by NRT
            // annotations, not Nullable<T>, so wrap it here to match the
            // emitted `field?: T | null`. Value-type nullables are already
            // handled above via System.Nullable`1.
            if (fieldRef.Kind != "nullable" && IsNullableReferenceProperty(prop))
            {
                fieldRef = new TypeRef { Kind = "nullable", Element = fieldRef };
            }

            fields[ToCamelCase(prop.Name)] = fieldRef;
        }
        visiting.Remove(typeIdentity);

        return new TypeRef
        {
            Kind = "object",
            Name = type.Name,
            Fields = fields.Count > 0 ? fields : null,
        };
    }

    /// <summary>
    /// Determines whether a reference-typed property is annotated nullable
    /// (e.g. <c>string?</c>) by reading the C# nullable-reference metadata:
    /// the property's <c>NullableAttribute</c>, falling back to the declaring
    /// type's <c>NullableContextAttribute</c>. Flag value 2 means nullable.
    /// </summary>
    private static bool IsNullableReferenceProperty(PropertyInfo prop)
    {
        if (prop.PropertyType.IsValueType)
            return false;

        var nullable = prop.GetCustomAttributesData()
            .FirstOrDefault(a => a.AttributeType.FullName == "System.Runtime.CompilerServices.NullableAttribute");
        if (nullable is not null && nullable.ConstructorArguments.Count > 0)
        {
            return FirstNullableFlag(nullable.ConstructorArguments[0]) == 2;
        }

        var context = prop.DeclaringType?.GetCustomAttributesData()
            .FirstOrDefault(a => a.AttributeType.FullName == "System.Runtime.CompilerServices.NullableContextAttribute");
        if (context is not null && context.ConstructorArguments.Count > 0
            && context.ConstructorArguments[0].Value is byte contextFlag)
        {
            return contextFlag == 2;
        }

        return false;
    }

    private static byte FirstNullableFlag(CustomAttributeTypedArgument arg)
        => arg.Value switch
        {
            byte b => b,
            IReadOnlyList<CustomAttributeTypedArgument> bytes when bytes.Count > 0 => (byte)bytes[0].Value!,
            _ => 0,
        };

    private static string? MapPrimitive(Type type)
    {
        var fullName = type.FullName;
        return fullName switch
        {
            "System.String" => "string",
            "System.Boolean" => "boolean",
            "System.Int16" or "System.Int32" or "System.Int64" => "number",
            "System.UInt16" or "System.UInt32" or "System.UInt64" => "number",
            "System.Single" or "System.Double" or "System.Decimal" => "number",
            "System.Byte" or "System.SByte" => "number",
            "System.DateTime" or "System.DateTimeOffset" => "string",
            "System.Guid" => "string",
            _ => null,
        };
    }

    private static string ToCamelCase(string name)
    {
        if (string.IsNullOrEmpty(name)) return name;
        return char.ToLowerInvariant(name[0]) + name[1..];
    }

    private static IEnumerable<string> GetRuntimeAssemblies()
    {
        var runtimeDir = Path.GetDirectoryName(typeof(object).Assembly.Location)!;
        return Directory.GetFiles(runtimeDir, "*.dll");
    }
}
