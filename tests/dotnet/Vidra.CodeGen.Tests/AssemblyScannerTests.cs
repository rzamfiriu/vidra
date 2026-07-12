using Vidra.CodeGen;
using Vidra.CodeGen.TestFixtures;
using Vidra.Bridge;

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
}
