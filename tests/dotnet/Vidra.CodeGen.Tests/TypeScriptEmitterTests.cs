using Vidra.CodeGen;
using Vidra.CodeGen.TestFixtures;

namespace Vidra.CodeGen.Tests;

public sealed class TypeScriptEmitterTests
{
    private static string SnapshotDir
        => Path.Combine(AppContext.BaseDirectory, "Snapshots");

    // Source-tree copy of the Snapshots dir, used when VIDRA_UPDATE_SNAPSHOTS=1
    // is set so that regenerated golden files persist beyond the build output.
    private static string SourceSnapshotDir => Path.GetFullPath(
        Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "Snapshots"));

    private static bool ShouldUpdateSnapshots =>
        string.Equals(
            Environment.GetEnvironmentVariable("VIDRA_UPDATE_SNAPSHOTS"),
            "1",
            StringComparison.Ordinal);

    private static string ReadSnapshot(string name)
        => Normalize(File.ReadAllText(Path.Combine(SnapshotDir, name)));

    private static void WriteSnapshot(string name, string actual)
    {
        foreach (var dir in new[] { SnapshotDir, SourceSnapshotDir })
        {
            Directory.CreateDirectory(dir);
            File.WriteAllText(Path.Combine(dir, name), actual);
        }
    }

    private static string Normalize(string content)
        => content.Replace("\r\n", "\n").TrimEnd() + "\n";

    private static Manifest ScanFixture()
    {
        var path = typeof(SampleModule).Assembly.Location;
        return new AssemblyScanner(new[] { path }).Scan(new[] { path });
    }

    [Fact]
    public void EmitModule_Matches_Snapshot()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var actual = Normalize(emitter.EmitModule("sample", manifest.Modules["sample"]));

        if (ShouldUpdateSnapshots)
        {
            WriteSnapshot("sample.ts", actual);
            return;
        }

        var expected = ReadSnapshot("sample.ts");
        actual.Should().Be(expected);
    }

    [Fact]
    public void EmitBarrel_Matches_Snapshot()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var actual = Normalize(emitter.EmitBarrel(manifest));

        if (ShouldUpdateSnapshots)
        {
            WriteSnapshot("index.ts", actual);
            return;
        }

        var expected = ReadSnapshot("index.ts");
        actual.Should().Be(expected);
    }

    [Fact]
    public void EmitModule_Emits_Proxy_Class_With_Expected_Name()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var output = emitter.EmitModule("sample", manifest.Modules["sample"]);
        output.Should().Contain("export class SampleProxy");
        output.Should().Contain("this.client.invoke(\"sample\", \"echo\", args)");
    }

    [Fact]
    public void EmitModule_Uses_Custom_Sdk_Import()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var output = emitter.EmitModule("sample", manifest.Modules["sample"], "../sdk/index.js");
        output.Should().Contain("from \"../sdk/index.js\"");
    }
}
