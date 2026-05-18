using UINet.CodeGen;
using UINet.CodeGen.TestFixtures;

namespace UINet.CodeGen.Tests;

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

        manifest.Modules.Should().ContainKey("sample");
        manifest.Modules["sample"].ClassName.Should().Be("SampleModule");
    }

    [Fact]
    public void Scan_Extracts_Method_Name_From_Attribute()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var sample = manifest.Modules["sample"];
        sample.Methods.Should().ContainKey("echo");
    }

    [Fact]
    public void Scan_Resolves_Primitive_Types()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var paramsRef = manifest.Modules["sample"].Methods["echo"].Params!;
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

        var paramsRef = manifest.Modules["sample"].Methods["echo"].Params!;
        var count = paramsRef.Fields!["count"];
        count.Kind.Should().Be("nullable");
        count.Element!.Kind.Should().Be("primitive");
        count.Element.TsType.Should().Be("number");
    }

    [Fact]
    public void Scan_Resolves_Array_Types()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var returnsRef = manifest.Modules["sample"].Methods["echo"].Returns!;
        returnsRef.Fields!["tags"].Kind.Should().Be("array");
        returnsRef.Fields["tags"].Element!.TsType.Should().Be("string");
    }

    [Fact]
    public void Scan_Resolves_Enum_Types_With_Values()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var returnsRef = manifest.Modules["sample"].Methods["echo"].Returns!;
        var mood = returnsRef.Fields!["mood"];
        mood.Kind.Should().Be("enum");
        mood.Values.Should().BeEquivalentTo(new[] { "Happy", "Neutral", "Sad" });
    }

    [Fact]
    public void Scan_Skips_CancellationToken_Parameters()
    {
        var path = FixtureAssemblyPath();
        var manifest = new AssemblyScanner(new[] { path }).Scan(new[] { path });

        var method = manifest.Modules["sample"].Methods["echo"];
        method.Params.Should().NotBeNull();
        method.Params!.Fields.Should().NotContainKey("ct");
    }
}
