using System.Reflection;

namespace UINet.CodeGen;

/// <summary>
/// Scans compiled assemblies via MetadataLoadContext to extract module/method metadata
/// without requiring the MAUI runtime.
/// </summary>
public sealed class AssemblyScanner
{
    private readonly MetadataLoadContext _mlc;
    private readonly HashSet<string> _visitedTypes = new();

    public AssemblyScanner(string[] assemblyPaths)
    {
        // Collect all .dll files from the directories of input assemblies
        // so that transitive references (like UINet.Bridge) are resolvable.
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

                if (moduleAttr is null) continue;

                var moduleName = (string)moduleAttr.ConstructorArguments[0].Value!;
                var moduleManifest = ScanModule(type);
                manifest.Modules[moduleName] = moduleManifest;
            }
        }

        return manifest;
    }

    private ModuleManifest ScanModule(Type type)
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

        return new ModuleManifest
        {
            ClassName = type.Name,
            Methods = methods,
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

    private TypeRef ResolveType(Type type)
    {
        // Nullable<T>
        if (type.IsGenericType && type.GetGenericTypeDefinition().FullName == "System.Nullable`1")
        {
            return new TypeRef
            {
                Kind = "nullable",
                Element = ResolveType(type.GetGenericArguments()[0]),
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
                Element = ResolveType(type.GetElementType()!),
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
                    Element = ResolveType(type.GetGenericArguments()[0]),
                };
            }

            // Dictionary<string, T>
            if (genName.StartsWith("System.Collections.Generic.Dictionary`2") ||
                genName.StartsWith("System.Collections.Generic.IDictionary`2") ||
                genName.StartsWith("System.Collections.Generic.IReadOnlyDictionary`2"))
            {
                return new TypeRef
                {
                    Kind = "record",
                    Name = $"Record<string, {MapPrimitive(type.GetGenericArguments()[1]) ?? "unknown"}>",
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
        var fields = new Dictionary<string, TypeRef>();
        foreach (var prop in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
        {
            fields[ToCamelCase(prop.Name)] = ResolveType(prop.PropertyType);
        }

        return new TypeRef
        {
            Kind = "object",
            Name = type.Name,
            Fields = fields.Count > 0 ? fields : null,
        };
    }

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
