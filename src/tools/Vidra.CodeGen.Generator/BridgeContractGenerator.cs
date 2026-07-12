using System.Collections.Immutable;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;
using Microsoft.CodeAnalysis.Text;
using Vidra.CodeGen.Model;

namespace Vidra.CodeGen.Generator;

[Generator(LanguageNames.CSharp)]
public sealed class BridgeContractGenerator : IIncrementalGenerator
{
    private const string EventContractAttribute = "Vidra.Bridge.BridgeEventContractAttribute";
    private const string EventAttribute = "Vidra.Bridge.BridgeEventAttribute";
    private const string JsContractAttribute = "Vidra.Bridge.JsContractAttribute";
    private const string JsMethodAttribute = "Vidra.Bridge.JsMethodAttribute";
    private const string NativeContractAttribute = "Vidra.Bridge.BridgeModuleAttribute";
    private const string NativeMethodAttribute = "Vidra.Bridge.BridgeMethodAttribute";

    private static readonly DiagnosticDescriptor InvalidContract = new(
        "VIDRA001",
        "Invalid bridge contract",
        "{0}",
        "Vidra.CodeGen",
        DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    private static readonly DiagnosticDescriptor UnsupportedType = new(
        "VIDRA002",
        "Unsupported bridge contract type",
        "Type '{0}' is not supported in generated bridge contracts: {1}",
        "Vidra.CodeGen",
        DiagnosticSeverity.Error,
        isEnabledByDefault: true);

    public void Initialize(IncrementalGeneratorInitializationContext context)
    {
        var eventContracts = context.SyntaxProvider.ForAttributeWithMetadataName(
            EventContractAttribute,
            static (node, _) => node is InterfaceDeclarationSyntax,
            static (ctx, _) => CreateCandidate(ctx, ContractKind.Event));

        var jsContracts = context.SyntaxProvider.ForAttributeWithMetadataName(
            JsContractAttribute,
            static (node, _) => node is InterfaceDeclarationSyntax,
            static (ctx, _) => CreateCandidate(ctx, ContractKind.Js));

        var nativeContracts = context.SyntaxProvider.ForAttributeWithMetadataName(
            NativeContractAttribute,
            static (node, _) => node is ClassDeclarationSyntax,
            static (ctx, _) => CreateCandidate(ctx, ContractKind.Native));

        var inputs = context.CompilationProvider
            .Combine(eventContracts.Collect())
            .Combine(jsContracts.Collect())
            .Combine(nativeContracts.Collect())
            .Combine(context.AnalyzerConfigOptionsProvider);

        context.RegisterSourceOutput(inputs, static (source, input) =>
        {
            var ((((compilation, events), js), native), options) = input;
            Emit(source, compilation, events, js, native, options);
        });
    }

    private static ContractCandidate CreateCandidate(
        GeneratorAttributeSyntaxContext context,
        ContractKind kind)
    {
        var attribute = context.Attributes[0];
        var name = attribute.ConstructorArguments.Length == 1
            ? attribute.ConstructorArguments[0].Value as string
            : null;
        return new ContractCandidate((INamedTypeSymbol)context.TargetSymbol, name, kind);
    }

    private static void Emit(
        SourceProductionContext context,
        Compilation compilation,
        ImmutableArray<ContractCandidate> eventCandidates,
        ImmutableArray<ContractCandidate> jsCandidates,
        ImmutableArray<ContractCandidate> nativeCandidates,
        AnalyzerConfigOptionsProvider options)
    {
        var specs = new List<ContractSpec>();
        foreach (var candidate in eventCandidates.Concat(jsCandidates).Concat(nativeCandidates))
        {
            var spec = BuildContract(context, candidate);
            if (spec is not null)
                specs.Add(spec);
        }

        if (specs.Count == 0)
            return;

        foreach (var spec in specs.Where(spec => spec.Kind == ContractKind.Event))
            context.AddSource($"{spec.SafeTypeName}.Events.g.cs", SourceText.From(EmitEventCatalog(spec), Encoding.UTF8));

        foreach (var group in specs
                     .Where(spec => spec.Kind == ContractKind.Js)
                     .GroupBy(spec => spec.Namespace, StringComparer.Ordinal))
        {
            var hintNamespace = string.IsNullOrEmpty(group.Key) ? "Global" : Sanitize(group.Key);
            context.AddSource($"{hintNamespace}.JsContracts.g.cs", SourceText.From(EmitJsFacade(group.ToArray()), Encoding.UTF8));
        }

        var codecRoots = specs
            .Where(spec => spec.Kind is ContractKind.Event or ContractKind.Js)
            .SelectMany(spec => spec.Members)
            .SelectMany(member => new[] { member.Payload, member.Result })
            .Where(type => type is not null)
            .Cast<ITypeSymbol>()
            .Distinct<ITypeSymbol>(SymbolEqualityComparer.Default)
            .ToArray();
        if (codecRoots.Length > 0)
        {
            context.AddSource(
                "VidraContractJsonCodec.g.cs",
                SourceText.From(EmitJsonCodec(codecRoots), Encoding.UTF8));
        }

        var entries = specs.SelectMany(ToEntries).ToArray();
        var canonicalManifest = ContractFingerprint.Canonicalize(entries);
        var assemblyName = compilation.AssemblyName ?? "Vidra.Contracts";
        var scope = "App";
        if (options.GlobalOptions.TryGetValue("build_property.VidraContractScope", out var configuredScope)
            && string.Equals(configuredScope, "Core", StringComparison.OrdinalIgnoreCase))
        {
            scope = "Core";
        }

        context.AddSource(
            "VidraContractRegistration.g.cs",
            SourceText.From(EmitRegistration(assemblyName, scope, canonicalManifest), Encoding.UTF8));
    }

    private static ContractSpec? BuildContract(
        SourceProductionContext context,
        ContractCandidate candidate)
    {
        if (string.IsNullOrWhiteSpace(candidate.Name))
        {
            Report(context, candidate.Symbol, "Contract names must be explicit and non-empty.");
            return null;
        }

        var members = new List<MemberSpec>();
        var wireNames = new HashSet<string>(StringComparer.Ordinal);
        foreach (var method in candidate.Symbol.GetMembers().OfType<IMethodSymbol>())
        {
            var expectedAttribute = candidate.Kind switch
            {
                ContractKind.Event => EventAttribute,
                ContractKind.Js => JsMethodAttribute,
                _ => NativeMethodAttribute,
            };
            var attribute = method.GetAttributes()
                .FirstOrDefault(item => item.AttributeClass?.ToDisplayString() == expectedAttribute);
            if (attribute is null)
                continue;

            var wireName = attribute.ConstructorArguments.Length == 1
                ? attribute.ConstructorArguments[0].Value as string
                : null;
            if (string.IsNullOrWhiteSpace(wireName))
            {
                Report(context, method, $"Member '{method.Name}' must have an explicit non-empty wire name.");
                continue;
            }
            if (!wireNames.Add(wireName!))
            {
                Report(context, method, $"Contract '{candidate.Name}' declares duplicate member '{wireName}'.");
                continue;
            }

            var parameters = method.Parameters
                .Where(parameter => parameter.Type.ToDisplayString() != "System.Threading.CancellationToken")
                .ToArray();
            if (parameters.Length > 1)
            {
                Report(context, method, $"Member '{method.Name}' must have zero or one payload parameter.");
                continue;
            }

            ITypeSymbol? result = null;
            if (candidate.Kind == ContractKind.Event)
            {
                if (!method.ReturnsVoid)
                {
                    Report(context, method, $"Event member '{method.Name}' must return void.");
                    continue;
                }
            }
            else if (!TryUnwrapTask(method.ReturnType, out result))
            {
                Report(context, method, $"{candidate.Kind} member '{method.Name}' must return Task or Task<T>.");
                continue;
            }

            var payload = parameters.FirstOrDefault()?.Type;
            if (!ValidateType(context, payload, method, new HashSet<ITypeSymbol>(SymbolEqualityComparer.Default))
                || !ValidateType(context, result, method, new HashSet<ITypeSymbol>(SymbolEqualityComparer.Default)))
            {
                continue;
            }

            members.Add(new MemberSpec(method.Name, wireName!, payload, result));
        }

        if (members.Count == 0)
        {
            Report(context, candidate.Symbol, $"Contract '{candidate.Name}' does not declare any attributed members.");
            return null;
        }

        var ns = candidate.Symbol.ContainingNamespace.IsGlobalNamespace
            ? string.Empty
            : candidate.Symbol.ContainingNamespace.ToDisplayString();
        return new ContractSpec(
            candidate.Name!,
            candidate.Kind,
            ns,
            ContractBaseName(candidate.Symbol.Name, candidate.Kind),
            members.OrderBy(member => member.WireName, StringComparer.Ordinal).ToArray());
    }

    private static bool TryUnwrapTask(ITypeSymbol type, out ITypeSymbol? result)
    {
        result = null;
        if (type is not INamedTypeSymbol named || named.ContainingNamespace.ToDisplayString() != "System.Threading.Tasks")
            return false;

        if (named.Name == "Task" && named.TypeArguments.Length == 0)
            return true;
        if (named.Name == "Task" && named.TypeArguments.Length == 1)
        {
            result = named.TypeArguments[0];
            return true;
        }
        return false;
    }

    private static bool ValidateType(
        SourceProductionContext context,
        ITypeSymbol? type,
        ISymbol location,
        HashSet<ITypeSymbol> visiting)
    {
        if (type is null)
            return true;

        if (type.SpecialType is SpecialType.System_String
            or SpecialType.System_Boolean
            or SpecialType.System_Byte
            or SpecialType.System_SByte
            or SpecialType.System_Int16
            or SpecialType.System_UInt16
            or SpecialType.System_Int32
            or SpecialType.System_UInt32
            or SpecialType.System_Int64
            or SpecialType.System_UInt64
            or SpecialType.System_Single
            or SpecialType.System_Double
            or SpecialType.System_Decimal)
        {
            return true;
        }

        if (type.TypeKind == TypeKind.Enum)
            return true;
        if (type is IArrayTypeSymbol array)
            return ValidateType(context, array.ElementType, location, visiting);
        if (type is not INamedTypeSymbol named)
            return ReportUnsupported(context, location, type, "only records, classes, enums, arrays, and supported collections are allowed");

        var metadataName = named.OriginalDefinition.ToDisplayString();
        if (metadataName is "System.Nullable<T>"
            or "System.Collections.Generic.List<T>"
            or "System.Collections.Generic.IReadOnlyList<T>"
            or "System.Collections.Generic.IList<T>")
        {
            return ValidateType(context, named.TypeArguments[0], location, visiting);
        }
        if (metadataName is "System.Collections.Generic.Dictionary<TKey, TValue>"
            or "System.Collections.Generic.IDictionary<TKey, TValue>"
            or "System.Collections.Generic.IReadOnlyDictionary<TKey, TValue>")
        {
            if (named.TypeArguments[0].SpecialType != SpecialType.System_String)
            {
                return ReportUnsupported(
                    context,
                    location,
                    type,
                    "dictionary keys must be strings");
            }
            return ValidateType(context, named.TypeArguments[1], location, visiting);
        }
        if (named.ToDisplayString() is "System.Guid" or "System.DateTime" or "System.DateTimeOffset")
            return true;
        if (named.IsGenericType)
            return ReportUnsupported(context, location, type, "open or custom generic DTOs are not supported");
        if (!visiting.Add(named))
            return ReportUnsupported(context, location, type, "cyclic object graphs are not supported");

        var properties = named.GetMembers().OfType<IPropertySymbol>()
            .Where(property => property.DeclaredAccessibility == Accessibility.Public && !property.IsStatic)
            .ToArray();
        if (properties.Length == 0)
            return ReportUnsupported(context, location, type, "object DTOs must expose public properties");

        var hasMatchingConstructor = named.InstanceConstructors
            .Where(ctor => ctor.DeclaredAccessibility == Accessibility.Public)
            .Any(ctor =>
                ctor.Parameters.Length == properties.Length
                && ctor.Parameters.All(parameter =>
                    properties.Any(property =>
                        string.Equals(property.Name, parameter.Name, StringComparison.OrdinalIgnoreCase)
                        && SymbolEqualityComparer.Default.Equals(property.Type, parameter.Type))));
        var hasSettableParameterlessShape = named.InstanceConstructors
                                                .Any(ctor => ctor.DeclaredAccessibility == Accessibility.Public
                                                             && ctor.Parameters.Length == 0)
                                            && properties.All(property => property.SetMethod is not null);
        if (!hasMatchingConstructor && !hasSettableParameterlessShape)
        {
            return ReportUnsupported(
                context,
                location,
                type,
                "object DTOs need a matching public constructor or settable properties plus a public parameterless constructor");
        }

        var valid = properties.All(property => ValidateType(context, property.Type, property, visiting));
        visiting.Remove(named);
        return valid;
    }

    private static bool ReportUnsupported(
        SourceProductionContext context,
        ISymbol location,
        ITypeSymbol type,
        string reason)
    {
        context.ReportDiagnostic(Diagnostic.Create(
            UnsupportedType,
            location.Locations.FirstOrDefault(),
            type.ToDisplayString(),
            reason));
        return false;
    }

    private static string EmitEventCatalog(ContractSpec spec)
    {
        var sb = FileHeader(spec.Namespace);
        sb.AppendLine($"public static class {spec.SafeTypeName}");
        sb.AppendLine("{");
        foreach (var member in spec.Members)
        {
            var property = RemoveAsync(member.ClrName);
            if (member.Payload is null)
            {
                sb.AppendLine(
                    $"    public static global::Vidra.Bridge.BridgeEventToken {property} {{ get; }} = new(\"{Escape(spec.Name)}\", \"{Escape(member.WireName)}\");");
            }
            else
            {
                var type = TypeName(member.Payload);
                sb.AppendLine(
                    $"    public static global::Vidra.Bridge.BridgeEventToken<{type}> {property} {{ get; }} = new(\"{Escape(spec.Name)}\", \"{Escape(member.WireName)}\", global::Vidra.Generated.VidraContractJsonCodec.Serialize_{CodecName(member.Payload)});");
            }
        }
        sb.AppendLine("}");
        return sb.ToString();
    }

    private static string EmitJsFacade(IReadOnlyList<ContractSpec> specs)
    {
        var ns = specs[0].Namespace;
        var sb = FileHeader(ns);
        sb.AppendLine("public static class VidraGeneratedJsExtensions");
        sb.AppendLine("{");
        sb.AppendLine("    public static VidraJsContracts Js(this global::Vidra.Bridge.IJsCallbackChannel channel) => new(channel);");
        sb.AppendLine("}");
        sb.AppendLine();
        sb.AppendLine("public readonly struct VidraJsContracts");
        sb.AppendLine("{");
        sb.AppendLine("    private readonly global::Vidra.Bridge.IJsCallbackChannel _channel;");
        sb.AppendLine("    public VidraJsContracts(global::Vidra.Bridge.IJsCallbackChannel channel) => _channel = channel;");
        foreach (var spec in specs)
            sb.AppendLine($"    public {spec.SafeTypeName}JsClient {spec.SafeTypeName} => new(_channel);");
        sb.AppendLine("}");

        foreach (var spec in specs)
        {
            sb.AppendLine();
            sb.AppendLine($"public readonly struct {spec.SafeTypeName}JsClient");
            sb.AppendLine("{");
            sb.AppendLine("    private readonly global::Vidra.Bridge.IJsCallbackChannel _channel;");
            sb.AppendLine($"    public {spec.SafeTypeName}JsClient(global::Vidra.Bridge.IJsCallbackChannel channel) => _channel = channel;");
            foreach (var member in spec.Members)
                EmitJsMethod(sb, spec, member);
            sb.AppendLine("}");
        }
        return sb.ToString();
    }

    private static void EmitJsMethod(StringBuilder sb, ContractSpec contract, MemberSpec member)
    {
        var returnType = member.Result is null ? "global::System.Threading.Tasks.Task" : $"global::System.Threading.Tasks.Task<{TypeName(member.Result)}>";
        var payloadParameter = member.Payload is null ? string.Empty : $"{TypeName(member.Payload)} payload, ";
        sb.AppendLine();
        sb.AppendLine($"    public {returnType} {member.ClrName}({payloadParameter}global::System.Threading.CancellationToken ct = default)");
        sb.AppendLine("    {");

        var token = JsTokenExpression(contract, member);
        var call = member.Payload is null
            ? $"_channel.CallJsAsync({token}, ct)"
            : $"_channel.CallJsAsync({token}, payload, ct)";
        sb.AppendLine($"        return {call};");
        sb.AppendLine("    }");
    }

    private static string JsTokenExpression(ContractSpec contract, MemberSpec member)
    {
        var prefix = $"\"{Escape(contract.Name)}\", \"{Escape(member.WireName)}\"";
        if (member.Payload is null && member.Result is null)
            return $"new global::Vidra.Bridge.JsMethodToken({prefix})";
        if (member.Payload is null)
        {
            var result = TypeName(member.Result!);
            return $"new global::Vidra.Bridge.JsMethodToken<{result}>({prefix}, global::Vidra.Generated.VidraContractJsonCodec.Deserialize_{CodecName(member.Result!)})";
        }
        if (member.Result is null)
        {
            var payload = TypeName(member.Payload!);
            return $"new global::Vidra.Bridge.JsMethodPayloadToken<{payload}>({prefix}, global::Vidra.Generated.VidraContractJsonCodec.Serialize_{CodecName(member.Payload!)})";
        }

        var payloadType = TypeName(member.Payload!);
        var resultType = TypeName(member.Result!);
        return $"new global::Vidra.Bridge.JsMethodToken<{payloadType}, {resultType}>({prefix}, global::Vidra.Generated.VidraContractJsonCodec.Serialize_{CodecName(member.Payload!)}, global::Vidra.Generated.VidraContractJsonCodec.Deserialize_{CodecName(member.Result!)})";
    }

    private static string EmitJsonCodec(IEnumerable<ITypeSymbol> roots)
    {
        var types = new Dictionary<string, ITypeSymbol>(StringComparer.Ordinal);
        foreach (var root in roots)
            CollectCodecTypes(root, types);

        var sb = new StringBuilder();
        sb.AppendLine("// <auto-generated />");
        sb.AppendLine("#nullable enable");
        sb.AppendLine("using System.Linq;");
        sb.AppendLine();
        sb.AppendLine("namespace Vidra.Generated;");
        sb.AppendLine();
        sb.AppendLine("internal static class VidraContractJsonCodec");
        sb.AppendLine("{");
        sb.AppendLine("    private static global::System.Text.Json.JsonElement ToElement(global::System.Text.Json.Nodes.JsonNode? node)");
        sb.AppendLine("    {");
        sb.AppendLine("        var buffer = new global::System.Buffers.ArrayBufferWriter<byte>();");
        sb.AppendLine("        using (var writer = new global::System.Text.Json.Utf8JsonWriter(buffer))");
        sb.AppendLine("        {");
        sb.AppendLine("            if (node is null) writer.WriteNullValue(); else node.WriteTo(writer);");
        sb.AppendLine("        }");
        sb.AppendLine("        using var document = global::System.Text.Json.JsonDocument.Parse(buffer.WrittenMemory);");
        sb.AppendLine("        return document.RootElement.Clone();");
        sb.AppendLine("    }");

        foreach (var type in types.Values.OrderBy(TypeName, StringComparer.Ordinal))
        {
            var typeName = TypeName(type);
            var codecName = CodecName(type);
            sb.AppendLine();
            sb.AppendLine($"    internal static global::System.Text.Json.JsonElement Serialize_{codecName}({typeName} value)");
            sb.AppendLine($"        => ToElement(ToNode_{codecName}(value));");
            sb.AppendLine();
            sb.AppendLine($"    internal static {typeName} Deserialize_{codecName}(global::System.Text.Json.JsonElement element)");
            sb.AppendLine($"        => FromElement_{codecName}(element);");
            sb.AppendLine();
            sb.AppendLine($"    private static global::System.Text.Json.Nodes.JsonNode? ToNode_{codecName}({typeName} value)");
            sb.AppendLine("    {");
            EmitToNodeBody(sb, type, "value", 2);
            sb.AppendLine("    }");
            sb.AppendLine();
            sb.AppendLine($"    private static {typeName} FromElement_{codecName}(global::System.Text.Json.JsonElement element)");
            sb.AppendLine("    {");
            EmitFromElementBody(sb, type, "element", 2);
            sb.AppendLine("    }");
        }

        sb.AppendLine("}");
        return sb.ToString();
    }

    private static void CollectCodecTypes(ITypeSymbol type, Dictionary<string, ITypeSymbol> collected)
    {
        var key = CodecName(type);
        if (collected.ContainsKey(key))
            return;
        collected.Add(key, type.WithNullableAnnotation(NullableAnnotation.NotAnnotated));

        if (type is IArrayTypeSymbol array)
        {
            CollectCodecTypes(array.ElementType, collected);
            return;
        }
        if (type is not INamedTypeSymbol named)
            return;

        foreach (var argument in named.TypeArguments)
            CollectCodecTypes(argument, collected);

        if (IsObjectType(named))
        {
            foreach (var property in SerializableProperties(named))
                CollectCodecTypes(property.Type, collected);
        }
    }

    private static void EmitToNodeBody(
        StringBuilder sb,
        ITypeSymbol type,
        string value,
        int indent)
    {
        var pad = new string(' ', indent * 4);
        if (type.IsReferenceType)
            sb.AppendLine($"{pad}if ({value} is null) return null;");

        var primitiveFactory = type.SpecialType switch
        {
            SpecialType.System_String
                or SpecialType.System_Boolean
                or SpecialType.System_Byte
                or SpecialType.System_SByte
                or SpecialType.System_Int16
                or SpecialType.System_UInt16
                or SpecialType.System_Int32
                or SpecialType.System_UInt32
                or SpecialType.System_Int64
                or SpecialType.System_UInt64
                or SpecialType.System_Single
                or SpecialType.System_Double
                or SpecialType.System_Decimal
                => $"global::System.Text.Json.Nodes.JsonValue.Create({value})",
            _ => null,
        };
        if (primitiveFactory is not null)
        {
            sb.AppendLine($"{pad}return {primitiveFactory};");
            return;
        }

        if (type.TypeKind == TypeKind.Enum)
        {
            sb.AppendLine($"{pad}return global::System.Text.Json.Nodes.JsonValue.Create({value} switch");
            sb.AppendLine($"{pad}{{");
            foreach (var field in type.GetMembers().OfType<IFieldSymbol>().Where(field => field.HasConstantValue))
                sb.AppendLine($"{pad}    {TypeName(type)}.{field.Name} => \"{ToCamelCase(field.Name)}\",");
            sb.AppendLine($"{pad}    _ => throw new global::System.Text.Json.JsonException(\"Unsupported enum value for {type.Name}.\"),");
            sb.AppendLine($"{pad}}});");
            return;
        }

        if (type is IArrayTypeSymbol array)
        {
            EmitCollectionToNode(sb, array.ElementType, value, pad);
            return;
        }
        if (type is not INamedTypeSymbol named)
            throw new InvalidOperationException($"Unsupported codec type '{type}'.");

        var metadataName = named.OriginalDefinition.ToDisplayString();
        if (metadataName == "System.Nullable<T>")
        {
            sb.AppendLine($"{pad}if (!{value}.HasValue) return null;");
            sb.AppendLine($"{pad}return ToNode_{CodecName(named.TypeArguments[0])}({value}.Value);");
            return;
        }
        if (metadataName is "System.Collections.Generic.List<T>"
            or "System.Collections.Generic.IReadOnlyList<T>"
            or "System.Collections.Generic.IList<T>")
        {
            EmitCollectionToNode(sb, named.TypeArguments[0], value, pad);
            return;
        }
        if (metadataName is "System.Collections.Generic.Dictionary<TKey, TValue>"
            or "System.Collections.Generic.IDictionary<TKey, TValue>"
            or "System.Collections.Generic.IReadOnlyDictionary<TKey, TValue>")
        {
            sb.AppendLine($"{pad}var node = new global::System.Text.Json.Nodes.JsonObject();");
            sb.AppendLine($"{pad}foreach (var pair in {value})");
            sb.AppendLine($"{pad}    node[pair.Key] = ToNode_{CodecName(named.TypeArguments[1])}(pair.Value);");
            sb.AppendLine($"{pad}return node;");
            return;
        }
        if (named.ToDisplayString() is "System.Guid" or "System.DateTime" or "System.DateTimeOffset")
        {
            sb.AppendLine($"{pad}return global::System.Text.Json.Nodes.JsonValue.Create({value});");
            return;
        }

        sb.AppendLine($"{pad}var node = new global::System.Text.Json.Nodes.JsonObject();");
        foreach (var property in SerializableProperties(named))
        {
            var jsonName = ToCamelCase(property.Name);
            if ((property.Type.IsReferenceType && property.NullableAnnotation == NullableAnnotation.Annotated)
                || IsNullableValueType(property.Type))
            {
                sb.AppendLine($"{pad}if ({value}.{property.Name} is not null)");
                sb.AppendLine($"{pad}    node[\"{jsonName}\"] = ToNode_{CodecName(property.Type)}({value}.{property.Name});");
            }
            else
            {
                sb.AppendLine($"{pad}node[\"{jsonName}\"] = ToNode_{CodecName(property.Type)}({value}.{property.Name});");
            }
        }
        sb.AppendLine($"{pad}return node;");
    }

    private static void EmitCollectionToNode(
        StringBuilder sb,
        ITypeSymbol elementType,
        string value,
        string pad)
    {
        sb.AppendLine($"{pad}var node = new global::System.Text.Json.Nodes.JsonArray();");
        sb.AppendLine($"{pad}foreach (var item in {value})");
        sb.AppendLine($"{pad}    node.Add(ToNode_{CodecName(elementType)}(item));");
        sb.AppendLine($"{pad}return node;");
    }

    private static void EmitFromElementBody(
        StringBuilder sb,
        ITypeSymbol type,
        string element,
        int indent)
    {
        var pad = new string(' ', indent * 4);
        var primitiveRead = type.SpecialType switch
        {
            SpecialType.System_String => $"{element}.GetString()!",
            SpecialType.System_Boolean => $"{element}.GetBoolean()",
            SpecialType.System_Byte => $"{element}.GetByte()",
            SpecialType.System_SByte => $"{element}.GetSByte()",
            SpecialType.System_Int16 => $"{element}.GetInt16()",
            SpecialType.System_UInt16 => $"{element}.GetUInt16()",
            SpecialType.System_Int32 => $"{element}.GetInt32()",
            SpecialType.System_UInt32 => $"{element}.GetUInt32()",
            SpecialType.System_Int64 => $"{element}.GetInt64()",
            SpecialType.System_UInt64 => $"{element}.GetUInt64()",
            SpecialType.System_Single => $"{element}.GetSingle()",
            SpecialType.System_Double => $"{element}.GetDouble()",
            SpecialType.System_Decimal => $"{element}.GetDecimal()",
            _ => null,
        };
        if (primitiveRead is not null)
        {
            sb.AppendLine($"{pad}return {primitiveRead};");
            return;
        }

        if (type.TypeKind == TypeKind.Enum)
        {
            sb.AppendLine($"{pad}return {element}.GetString() switch");
            sb.AppendLine($"{pad}{{");
            foreach (var field in type.GetMembers().OfType<IFieldSymbol>().Where(field => field.HasConstantValue))
                sb.AppendLine($"{pad}    \"{ToCamelCase(field.Name)}\" => {TypeName(type)}.{field.Name},");
            sb.AppendLine($"{pad}    _ => throw new global::System.Text.Json.JsonException(\"Invalid {type.Name} value.\"),");
            sb.AppendLine($"{pad}}};");
            return;
        }

        if (type is IArrayTypeSymbol array)
        {
            sb.AppendLine($"{pad}return {element}.EnumerateArray()");
            sb.AppendLine($"{pad}    .Select(item => FromElement_{CodecName(array.ElementType)}(item))");
            sb.AppendLine($"{pad}    .ToArray();");
            return;
        }
        if (type is not INamedTypeSymbol named)
            throw new InvalidOperationException($"Unsupported codec type '{type}'.");

        var metadataName = named.OriginalDefinition.ToDisplayString();
        if (metadataName == "System.Nullable<T>")
        {
            sb.AppendLine($"{pad}return {element}.ValueKind == global::System.Text.Json.JsonValueKind.Null");
            sb.AppendLine($"{pad}    ? default");
            sb.AppendLine($"{pad}    : FromElement_{CodecName(named.TypeArguments[0])}({element});");
            return;
        }
        if (metadataName is "System.Collections.Generic.List<T>"
            or "System.Collections.Generic.IReadOnlyList<T>"
            or "System.Collections.Generic.IList<T>")
        {
            sb.AppendLine($"{pad}return {element}.EnumerateArray()");
            sb.AppendLine($"{pad}    .Select(item => FromElement_{CodecName(named.TypeArguments[0])}(item))");
            sb.AppendLine($"{pad}    .ToList();");
            return;
        }
        if (metadataName is "System.Collections.Generic.Dictionary<TKey, TValue>"
            or "System.Collections.Generic.IDictionary<TKey, TValue>"
            or "System.Collections.Generic.IReadOnlyDictionary<TKey, TValue>")
        {
            sb.AppendLine($"{pad}return {element}.EnumerateObject().ToDictionary(");
            sb.AppendLine($"{pad}    property => property.Name,");
            sb.AppendLine($"{pad}    property => FromElement_{CodecName(named.TypeArguments[1])}(property.Value));");
            return;
        }
        if (named.ToDisplayString() == "System.Guid")
        {
            sb.AppendLine($"{pad}return {element}.GetGuid();");
            return;
        }
        if (named.ToDisplayString() == "System.DateTime")
        {
            sb.AppendLine($"{pad}return {element}.GetDateTime();");
            return;
        }
        if (named.ToDisplayString() == "System.DateTimeOffset")
        {
            sb.AppendLine($"{pad}return {element}.GetDateTimeOffset();");
            return;
        }

        var properties = SerializableProperties(named);
        var constructor = named.InstanceConstructors
            .Where(ctor => ctor.DeclaredAccessibility == Accessibility.Public)
            .FirstOrDefault(ctor =>
                ctor.Parameters.Length == properties.Length
                && ctor.Parameters.All(parameter =>
                    properties.Any(property =>
                        string.Equals(property.Name, parameter.Name, StringComparison.OrdinalIgnoreCase)
                        && SymbolEqualityComparer.Default.Equals(property.Type, parameter.Type))));

        if (constructor is not null)
        {
            var arguments = constructor.Parameters.Select(parameter =>
            {
                var property = properties.First(candidate =>
                    string.Equals(candidate.Name, parameter.Name, StringComparison.OrdinalIgnoreCase));
                return ReadPropertyExpression(property, element);
            });
            sb.AppendLine($"{pad}return new {TypeName(named)}(");
            sb.AppendLine($"{pad}    {string.Join($",{Environment.NewLine}{pad}    ", arguments)});");
            return;
        }

        var parameterless = named.InstanceConstructors
            .FirstOrDefault(ctor => ctor.DeclaredAccessibility == Accessibility.Public && ctor.Parameters.Length == 0);
        if (parameterless is null || properties.Any(property => property.SetMethod is null))
        {
            sb.AppendLine($"{pad}throw new global::System.Text.Json.JsonException(\"{named.Name} has no supported constructor.\");");
            return;
        }

        sb.AppendLine($"{pad}return new {TypeName(named)}");
        sb.AppendLine($"{pad}{{");
        foreach (var property in properties)
            sb.AppendLine($"{pad}    {property.Name} = {ReadPropertyExpression(property, element)},");
        sb.AppendLine($"{pad}}};");
    }

    private static string ReadPropertyExpression(IPropertySymbol property, string element)
    {
        var jsonName = ToCamelCase(property.Name);
        var codec = CodecName(property.Type);
        if ((property.Type.IsReferenceType && property.NullableAnnotation == NullableAnnotation.Annotated)
            || IsNullableValueType(property.Type))
        {
            var local = Sanitize(jsonName) + "Element";
            return $"{element}.TryGetProperty(\"{jsonName}\", out var {local}) && {local}.ValueKind != global::System.Text.Json.JsonValueKind.Null ? FromElement_{codec}({local}) : default";
        }
        return $"FromElement_{codec}({element}.GetProperty(\"{jsonName}\"))";
    }

    private static bool IsNullableValueType(ITypeSymbol type)
        => type is INamedTypeSymbol named
           && named.OriginalDefinition.ToDisplayString() == "System.Nullable<T>";

    private static bool IsObjectType(INamedTypeSymbol named)
    {
        if (named.TypeKind == TypeKind.Enum)
            return false;
        if (named.SpecialType != SpecialType.None)
            return false;
        if (named.ToDisplayString() is "System.Guid" or "System.DateTime" or "System.DateTimeOffset")
            return false;
        return !named.IsGenericType;
    }

    private static IPropertySymbol[] SerializableProperties(INamedTypeSymbol named)
        => named.GetMembers().OfType<IPropertySymbol>()
            .Where(property => property.DeclaredAccessibility == Accessibility.Public && !property.IsStatic)
            .OrderBy(property => property.Name, StringComparer.Ordinal)
            .ToArray();

    private static string CodecName(ITypeSymbol type)
        => Sanitize(type
            .WithNullableAnnotation(NullableAnnotation.NotAnnotated)
            .ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat));

    private static string EmitRegistration(string assemblyName, string scope, string canonicalManifest)
        => $$"""
             // <auto-generated />
             namespace Vidra.Generated;

             internal static class VidraContractRegistration
             {
                 [global::System.Runtime.CompilerServices.ModuleInitializer]
                 internal static void Register()
                     => global::Vidra.Bridge.BridgeContractRegistry.Register(
                         "{{Escape(assemblyName)}}",
                         global::Vidra.Bridge.BridgeManifestScope.{{scope}},
                         "{{Escape(canonicalManifest)}}");
             }
             """;

    private static IEnumerable<ContractEntry> ToEntries(ContractSpec spec)
        => spec.Members.Select(member => new ContractEntry
        {
            Contract = spec.Name,
            Member = member.WireName,
            Kind = spec.Kind switch
            {
                ContractKind.Event => ContractMemberKind.Event,
                ContractKind.Js => ContractMemberKind.JsMethod,
                _ => ContractMemberKind.NativeMethod,
            },
            PayloadSchema = TypeSchema(member.Payload, new HashSet<ITypeSymbol>(SymbolEqualityComparer.Default)),
            ResultSchema = TypeSchema(member.Result, new HashSet<ITypeSymbol>(SymbolEqualityComparer.Default)),
        });

    private static string? TypeSchema(ITypeSymbol? type, HashSet<ITypeSymbol> visiting)
    {
        if (type is null)
            return null;

        var primitive = type.SpecialType switch
        {
            SpecialType.System_String => "string",
            SpecialType.System_Boolean => "boolean",
            SpecialType.System_Byte
                or SpecialType.System_SByte
                or SpecialType.System_Int16
                or SpecialType.System_UInt16
                or SpecialType.System_Int32
                or SpecialType.System_UInt32
                or SpecialType.System_Int64
                or SpecialType.System_UInt64
                or SpecialType.System_Single
                or SpecialType.System_Double
                or SpecialType.System_Decimal => "number",
            _ => null,
        };
        if (primitive is not null)
            return $"primitive({primitive})";
        if (type.TypeKind == TypeKind.Enum)
            return $"enum({string.Join(",", type.GetMembers().OfType<IFieldSymbol>().Where(field => field.HasConstantValue).Select(field => field.Name))})";
        if (type is IArrayTypeSymbol array)
            return $"array({TypeSchema(array.ElementType, visiting)})";
        if (type is not INamedTypeSymbol named)
            return type.ToDisplayString();

        var metadataName = named.OriginalDefinition.ToDisplayString();
        if (metadataName == "System.Nullable<T>")
            return $"nullable({TypeSchema(named.TypeArguments[0], visiting)})";
        if (metadataName is "System.Collections.Generic.List<T>"
            or "System.Collections.Generic.IReadOnlyList<T>"
            or "System.Collections.Generic.IList<T>")
        {
            return $"array({TypeSchema(named.TypeArguments[0], visiting)})";
        }
        if (metadataName is "System.Collections.Generic.Dictionary<TKey, TValue>"
            or "System.Collections.Generic.IDictionary<TKey, TValue>"
            or "System.Collections.Generic.IReadOnlyDictionary<TKey, TValue>")
        {
            return $"dictionary({TypeSchema(named.TypeArguments[1], visiting)})";
        }
        if (named.ToDisplayString() is "System.Guid" or "System.DateTime" or "System.DateTimeOffset")
            return "primitive(string)";
        if (!visiting.Add(named))
            return "cycle";

        var fields = named.GetMembers().OfType<IPropertySymbol>()
            .Where(property => property.DeclaredAccessibility == Accessibility.Public && !property.IsStatic)
            .OrderBy(property => property.Name, StringComparer.Ordinal)
            .Select(property =>
            {
                var propertySchema = TypeSchema(property.Type, visiting);
                if (property.Type.IsReferenceType
                    && property.NullableAnnotation == NullableAnnotation.Annotated)
                {
                    propertySchema = $"nullable({propertySchema})";
                }
                return $"{ToCamelCase(property.Name)}:{propertySchema}";
            });
        var schema = $"object({named.Name}){{{string.Join(",", fields)}}}";
        visiting.Remove(named);
        return schema;
    }

    private static StringBuilder FileHeader(string ns)
    {
        var sb = new StringBuilder();
        sb.AppendLine("// <auto-generated />");
        sb.AppendLine("#nullable enable");
        if (!string.IsNullOrEmpty(ns))
        {
            sb.AppendLine();
            sb.AppendLine($"namespace {ns};");
        }
        sb.AppendLine();
        return sb;
    }

    private static string ContractBaseName(string interfaceName, ContractKind kind)
    {
        if (kind == ContractKind.Native)
            return interfaceName;

        var name = interfaceName.Length > 1 && interfaceName[0] == 'I' && char.IsUpper(interfaceName[1])
            ? interfaceName.Substring(1)
            : interfaceName;
        var suffix = kind == ContractKind.Event ? "Events" : "Js";
        return name.EndsWith(suffix, StringComparison.Ordinal)
            ? name.Substring(0, name.Length - suffix.Length) + (kind == ContractKind.Event ? "Events" : string.Empty)
            : name + (kind == ContractKind.Event ? "Events" : string.Empty);
    }

    private static string TypeName(ITypeSymbol type)
        => type.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat);

    private static string RemoveAsync(string name)
        => name.EndsWith("Async", StringComparison.Ordinal)
            ? name.Substring(0, name.Length - "Async".Length)
            : name;

    private static string ToCamelCase(string name)
        => string.IsNullOrEmpty(name)
            ? name
            : char.ToLowerInvariant(name[0]) + name.Substring(1);

    private static string Sanitize(string value)
        => new(value.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());

    private static string Escape(string value)
        => value
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n");

    private static void Report(SourceProductionContext context, ISymbol symbol, string message)
        => context.ReportDiagnostic(Diagnostic.Create(
            InvalidContract,
            symbol.Locations.FirstOrDefault(),
            message));

    private enum ContractKind
    {
        Native,
        Event,
        Js,
    }

    private sealed record ContractCandidate(INamedTypeSymbol Symbol, string? Name, ContractKind Kind);
    private sealed record ContractSpec(
        string Name,
        ContractKind Kind,
        string Namespace,
        string SafeTypeName,
        IReadOnlyList<MemberSpec> Members);
    private sealed record MemberSpec(
        string ClrName,
        string WireName,
        ITypeSymbol? Payload,
        ITypeSymbol? Result);
}
