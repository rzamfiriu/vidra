using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Vidra.Bridge;
using Vidra.CodeGen.Generator;

namespace Vidra.CodeGen.Tests;

public sealed class BridgeContractGeneratorTests
{
    private const string Source = """
        using System.Threading;
        using System.Threading.Tasks;
        using Vidra.Bridge;

        namespace Example;

        public record CounterPayload(int Amount);

        [BridgeEventContract("counter")]
        public interface ICounterEvents
        {
            [BridgeEvent("changed")]
            void Changed(CounterPayload payload);
        }

        [JsContract("counter")]
        public interface ICounterJs
        {
            [JsMethod("increment")]
            Task<int> IncrementAsync(CounterPayload payload, CancellationToken ct = default);
        }
        """;

    [Fact]
    public void Generator_Emits_Typed_Event_Tokens_And_Js_Facade()
    {
        var result = Run(Source);

        result.Diagnostics.Should().NotContain(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error);
        var generated = string.Join(
            "\n",
            result.GeneratedTrees.Select(tree => tree.GetText().ToString()));
        generated.Should().Contain("BridgeEventToken<global::Example.CounterPayload>");
        generated.Should().Contain("public CounterJsClient Counter");
        generated.Should().Contain("IncrementAsync(global::Example.CounterPayload payload");
        generated.Should().Contain("VidraContractJsonCodec.Serialize_global__Example_CounterPayload");
        generated.Should().Contain("FromElement_int(element.GetProperty(\"amount\"))");
        generated.Should().NotContain("JsonSerializer.Serialize");
        generated.Should().NotContain("JsonSerializer.Deserialize");
    }

    [Fact]
    public void Generator_Rejects_Multiple_Payload_Parameters()
    {
        var source = """
            using System.Threading.Tasks;
            using Vidra.Bridge;

            [JsContract("bad")]
            public interface IBadJs
            {
                [JsMethod("bad")]
                Task BadAsync(string first, string second);
            }
            """;

        var result = Run(source);

        result.Diagnostics.Should().Contain(diagnostic => diagnostic.Id == "VIDRA001");
    }

    private static GeneratorDriverRunResult Run(string source)
    {
        var references = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!)
            .Split(Path.PathSeparator)
            .Select(path => MetadataReference.CreateFromFile(path))
            .Append(MetadataReference.CreateFromFile(typeof(BridgeModuleAttribute).Assembly.Location));

        var compilation = CSharpCompilation.Create(
            "GeneratorFixture",
            [CSharpSyntaxTree.ParseText(source)],
            references,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));

        GeneratorDriver driver = CSharpGeneratorDriver.Create(new BridgeContractGenerator());
        driver = driver.RunGeneratorsAndUpdateCompilation(compilation, out _, out _);
        return driver.GetRunResult();
    }
}
