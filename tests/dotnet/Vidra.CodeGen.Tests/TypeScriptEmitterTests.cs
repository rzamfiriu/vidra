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
    public void EmitContract_Matches_Snapshot()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var actual = Normalize(emitter.EmitContract("sample", manifest.Contracts["sample"]));

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
    public void EmitContract_Emits_Arrow_Factory_With_Expected_Name()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var output = emitter.EmitContract("sample", manifest.Contracts["sample"]);
        output.Should().Contain("export const createSample = (bridge: VidraBridge) => ({");
        output.Should().Contain("echo: (args: EchoArgs): Promise<EchoResult> =>");
        output.Should().Contain("bridge.unsafe.invoke(\"sample\", \"echo\", args),");
        output.Should().Contain("export type Sample = ReturnType<typeof createSample>;");
    }

    [Fact]
    public void EmitContract_Emits_Handler_Factory_For_Js_Methods()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var output = emitter.EmitContract("dialog", manifest.Contracts["dialog"]);
        output.Should().Contain("export const createDialogHandlers = (bridge: VidraBridge) => ({");
        output.Should().Contain("bridge.unsafe.handle(\"dialog\", \"confirm\", handler),");
        output.Should().Contain("export type DialogHandlers = ReturnType<typeof createDialogHandlers>;");
    }

    // The runtime SDK is written without classes, function declarations, or
    // method shorthand; generated output has to hold the same line.
    [Fact]
    public void Emitted_TypeScript_Contains_No_Classes_Or_Method_Shorthand()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var outputs = manifest.Contracts
            .Select(entry => emitter.EmitContract(entry.Key, entry.Value))
            .Append(emitter.EmitBarrel(manifest));

        foreach (var output in outputs)
        {
            output.Should().NotContain("class ");
            output.Should().NotContain("function ");
            output.Should().NotContain("constructor(");
            output.Should().NotContain("this.");
        }
    }

    [Fact]
    public void EmitBarrel_Declares_Fingerprint_And_Binds_Factories_To_The_Bridge()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var output = emitter.EmitBarrel(manifest, "../bridge.js", "core");
        output.Should().Contain("import { bridge, expectations } from \"../bridge.js\";");
        output.Should().Contain($"expectations.declare(\"core\", \"{manifest.Fingerprint}\");");
        output.Should().Contain("export const sample = createSample(bridge);");
        output.Should().Contain("export const dialogHandlers = createDialogHandlers(bridge);");
        output.Should().NotContain("register");
    }

    [Fact]
    public void EmitContract_Parenthesizes_Enum_Arrays()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var output = emitter.EmitContract("sample", manifest.Contracts["sample"]);
        output.Should().Contain("moods: (\"happy\" | \"neutral\" | \"sad\")[]");
    }

    [Fact]
    public void EmitContract_Uses_Custom_Sdk_Import()
    {
        var manifest = ScanFixture();
        var emitter = new TypeScriptEmitter();

        var output = emitter.EmitContract("sample", manifest.Contracts["sample"], "../sdk/index.js");
        output.Should().Contain("from \"../sdk/index.js\"");
    }

    [Fact]
    public void EmitAccessCatalog_Exposes_Native_Methods_And_Events_As_Tokens()
    {
        var manifest = ScanFixture();
        var output = new TypeScriptEmitter().EmitAccessCatalog(manifest);

        output.Should().Contain("sample: {");
        output.Should().Contain("echo: nativeMethodToken(\"sample\", \"echo\")");
        output.Should().Contain("changed: eventToken(\"sample\", \"changed\")");
        output.Should().Contain("from \"@vidra-dev/sdk/config/tokens\"");
    }

    // The scaffolded app has no contracts of its own, and its tsconfig sets
    // noUnusedLocals: an import the catalog never calls fails its UI build.
    [Fact]
    public void EmitAccessCatalog_Imports_Only_The_Factories_It_Calls()
    {
        var emitter = new TypeScriptEmitter();

        emitter.EmitAccessCatalog(new Manifest()).Should().NotContain("import");

        var methodsOnly = new Manifest();
        methodsOnly.Contracts["sample"] = new ContractManifest
        {
            NativeMethods = { ["echo"] = new MethodManifest() },
        };
        emitter.EmitAccessCatalog(methodsOnly).Should()
            .Contain("import { nativeMethodToken } from")
            .And.NotContain("eventToken");
    }
}
