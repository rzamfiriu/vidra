using System.Text.Json;
using UINet.CodeGen;

if (args.Length < 1 || args[0] != "generate")
{
    Console.Error.WriteLine("Usage: uinet-codegen generate --assembly <paths...> --output <dir>");
    return 1;
}

var assemblies = new List<string>();
string outputDir = ".";
string sdkImport = "@uinet/sdk";

for (var i = 1; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--assembly" or "-a":
            i++;
            while (i < args.Length && !args[i].StartsWith('-'))
            {
                assemblies.Add(args[i]);
                i++;
            }
            i--;
            break;
        case "--output" or "-o":
            i++;
            if (i < args.Length) outputDir = args[i];
            break;
        case "--sdk-import":
            i++;
            if (i < args.Length) sdkImport = args[i];
            break;
    }
}

if (assemblies.Count == 0)
{
    Console.Error.WriteLine("Error: at least one --assembly path is required.");
    return 1;
}

// Scan assemblies
var scanner = new AssemblyScanner(assemblies.ToArray());
var manifest = scanner.Scan(assemblies.ToArray());

Console.WriteLine($"Found {manifest.Modules.Count} module(s):");
foreach (var (name, mod) in manifest.Modules)
    Console.WriteLine($"  {name} ({mod.Methods.Count} methods)");

// Create output directory
Directory.CreateDirectory(outputDir);

// Write manifest.json
var manifestJson = JsonSerializer.Serialize(manifest, new JsonSerializerOptions
{
    WriteIndented = true,
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
});
var manifestPath = Path.Combine(outputDir, "manifest.json");
File.WriteAllText(manifestPath, manifestJson);
Console.WriteLine($"Wrote {manifestPath}");

// Write TypeScript proxies
var emitter = new TypeScriptEmitter();
foreach (var (moduleName, module) in manifest.Modules)
{
    var ts = emitter.EmitModule(moduleName, module, sdkImport);
    var tsPath = Path.Combine(outputDir, $"{moduleName}.ts");
    File.WriteAllText(tsPath, ts);
    Console.WriteLine($"Wrote {tsPath}");
}

// Write barrel index
var barrel = emitter.EmitBarrel(manifest, sdkImport);
var barrelPath = Path.Combine(outputDir, "index.ts");
File.WriteAllText(barrelPath, barrel);
Console.WriteLine($"Wrote {barrelPath}");

Console.WriteLine("Done.");
return 0;
