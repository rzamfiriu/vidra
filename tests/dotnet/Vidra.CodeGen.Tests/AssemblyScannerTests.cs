using Vidra.CodeGen;
using Vidra.CodeGen.TestFixtures;
using Vidra.Bridge;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Vidra.CodeGen.Tests;

public sealed class AssemblyScannerTests
{
    private static string FixtureAssemblyPath()
        => typeof(SampleModule).Assembly.Location;

    [Fact]
    public void Scan_Discovers_BridgeModule_Attributed_Types()
    {
        var path = FixtureAssemblyPath();
        var scanner = new AssemblyScanner(new[] { path });

        var manifest = scanner.Scan(new[] { path });

        manifest.Contracts.Should().ContainKey("sample");
        manifest.Contracts["sample"].ClassName.Should().Be("SampleModule");
    }

    [Fact]
    public void Scan_Extracts_Method_Name_From_Attribute()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var sample = manifest.Contracts["sample"];
        sample.NativeMethods.Should().ContainKey("echo");
    }

    [Fact]
    public void Scan_Resolves_Primitive_Types()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var paramsRef = manifest.Contracts["sample"].NativeMethods["echo"].Params!;
        paramsRef.Kind.Should().Be("object");
        paramsRef.Fields.Should().NotBeNull();
        paramsRef.Fields!["text"].Kind.Should().Be("primitive");
        paramsRef.Fields["text"].TsType.Should().Be("string");
    }

    [Fact]
    public void Scan_Wraps_Nullable_Primitive_Correctly()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var paramsRef = manifest.Contracts["sample"].NativeMethods["echo"].Params!;
        var count = paramsRef.Fields!["count"];
        count.Kind.Should().Be("nullable");
        count.Element!.Kind.Should().Be("primitive");
        count.Element.TsType.Should().Be("number");
    }

    [Fact]
    public void Scan_Wraps_Nullable_Reference_Correctly()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var returnsRef = manifest.Contracts["sample"].NativeMethods["echo"].Returns!;
        var note = returnsRef.Fields!["note"];
        note.Kind.Should().Be("nullable");
        note.Element!.Kind.Should().Be("primitive");
        note.Element.TsType.Should().Be("string");
    }

    [Fact]
    public void Scan_Resolves_Array_Types()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var returnsRef = manifest.Contracts["sample"].NativeMethods["echo"].Returns!;
        returnsRef.Fields!["tags"].Kind.Should().Be("array");
        returnsRef.Fields["tags"].Element!.TsType.Should().Be("string");
    }

    [Fact]
    public void Scan_Resolves_Enum_Types_With_Values()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var returnsRef = manifest.Contracts["sample"].NativeMethods["echo"].Returns!;
        var mood = returnsRef.Fields!["mood"];
        mood.Kind.Should().Be("enum");
        mood.Values.Should().BeEquivalentTo(new[] { "Happy", "Neutral", "Sad" });
    }

    [Fact]
    public void Scan_Skips_CancellationToken_Parameters()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var method = manifest.Contracts["sample"].NativeMethods["echo"];
        method.Params.Should().NotBeNull();
        method.Params!.Fields.Should().NotContainKey("ct");
    }

    [Fact]
    public void Scan_Merges_Events_Into_Their_Native_Contract()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var changed = manifest.Contracts["sample"].Events["changed"];
        changed.Payload!.Name.Should().Be("EchoResult");
    }

    [Fact]
    public void Scan_Discovers_Js_Contracts()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var confirm = manifest.Contracts["dialog"].JsMethods["confirm"];
        confirm.Params!.Name.Should().Be("EchoArgs");
        confirm.Returns!.TsType.Should().Be("boolean");
    }

    [Fact]
    public void Scan_Produces_A_Deterministic_Fingerprint()
    {
        var path = FixtureAssemblyPath();
        var first = new AssemblyScanner(new[] { path }).Scan(new[] { path });
        var second = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        first.Fingerprint.Should().NotBeNullOrWhiteSpace();
        first.Fingerprint.Should().Be(second.Fingerprint);
    }

    [Fact]
    public void Scanner_And_Source_Generator_Produce_The_Same_Fingerprint()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        BridgeContractRegistry.CanonicalManifest(BridgeManifestScope.App)
            .Should().Be(manifest.CanonicalManifest);
        BridgeContractRegistry.Fingerprint(BridgeManifestScope.App)
            .Should().Be(manifest.Fingerprint);
    }

    [Fact]
    public void Scan_Skips_Unresolvable_Attributes_On_Unrelated_Types()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"vidra-codegen-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);

        try
        {
            var missingDependency = Path.Combine(directory, "Missing.Dependency.dll");
            EmitAssembly(
                missingDependency,
                """
                public sealed class MissingMarkerAttribute : System.Attribute { }
                """);

            var fixture = Path.Combine(directory, "AndroidShapedApp.dll");
            EmitAssembly(
                fixture,
                """
                using Vidra.Bridge;

                [MissingMarker]
                public sealed class UnrelatedPlatformType { }

                [BridgeModule("surviving")]
                public sealed class SurvivingModule : BridgeModuleBase
                {
                    [BridgeMethod("ping")]
                    public string Ping() => "pong";
                }
                """,
                missingDependency,
                typeof(BridgeModuleAttribute).Assembly.Location);

            File.Copy(
                typeof(BridgeModuleAttribute).Assembly.Location,
                Path.Combine(directory, "Vidra.Bridge.dll"));
            File.Delete(missingDependency);

            using (var scanner = new AssemblyScanner([fixture]))
            {
                var manifest = scanner.Scan([fixture]);
                manifest.Contracts.Should().ContainKey("surviving");
            }
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void Scan_Resolves_Bridge_From_Probe_Directory_When_It_Is_Not_Beside_The_Assembly()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"vidra-codegen-{Guid.NewGuid():N}");
        var appDir = Path.Combine(directory, "app");
        var probeDir = Path.Combine(directory, "probe");
        Directory.CreateDirectory(appDir);
        Directory.CreateDirectory(probeDir);

        try
        {
            var bridge = typeof(BridgeModuleAttribute).Assembly.Location;
            var fixture = Path.Combine(appDir, "AndroidShapedApp.dll");
            EmitAssembly(
                fixture,
                """
                using Vidra.Bridge;

                [JsContract("counter")]
                public interface ICounterJs
                {
                    [JsMethod("increment")]
                    System.Threading.Tasks.Task<int> IncrementAsync();
                }
                """,
                bridge);
            File.Copy(bridge, Path.Combine(probeDir, "Vidra.Bridge.dll"));

            using var scanner = new AssemblyScanner([fixture], [probeDir]);
            var manifest = scanner.Scan([fixture]);

            manifest.Contracts.Should().ContainKey("counter");
            manifest.Contracts["counter"].JsMethods.Should().ContainKey("increment");
        }
        finally
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    private static void EmitAssembly(
        string output,
        string source,
        params string[] extraReferences)
    {
        var references = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!)
            .Split(Path.PathSeparator)
            .Select(path => MetadataReference.CreateFromFile(path))
            .Concat(extraReferences.Select(path => MetadataReference.CreateFromFile(path)));
        var compilation = CSharpCompilation.Create(
            Path.GetFileNameWithoutExtension(output),
            [CSharpSyntaxTree.ParseText(source)],
            references,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));

        var result = compilation.Emit(output);
        result.Success.Should().BeTrue(
            string.Join(Environment.NewLine, result.Diagnostics));
    }
}
