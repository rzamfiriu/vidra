using System.Text.Json;
using Vidra.Bridge;
using Vidra.Modules.FileSystem;

namespace Vidra.Modules.FileSystem.Tests;

public sealed class FileSystemModuleAttributeTests
{
    [Fact]
    public void Module_Advertises_Expected_Name()
    {
        var module = new FileSystemModule();
        module.ModuleName.Should().Be("filesystem");
    }

    [Fact]
    public void Module_Exposes_Expected_Methods()
    {
        var module = new FileSystemModule();
        module.SupportedMethods.Should().BeEquivalentTo(new[]
        {
            "readText", "writeText", "exists", "delete", "listDirectory",
        });
    }
}

public sealed class FileSystemModuleBehaviorTests : IDisposable
{
    private readonly string _dir;
    private readonly FileSystemModule _module = new();
    private readonly BridgeDispatcher _dispatcher;

    public FileSystemModuleBehaviorTests()
    {
        _dir = Path.Combine(Path.GetTempPath(), "vidra-fs-" + Path.GetRandomFileName());
        Directory.CreateDirectory(_dir);

        _dispatcher = new BridgeDispatcher();
        _dispatcher.Register(_module);
    }

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* best effort */ }
    }

    private async Task<JsonElement> InvokeAsync(string method, object? payload)
    {
        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = Guid.NewGuid().ToString("N"),
            Contract = "filesystem",
            Member = method,
            Payload = payload is null
                ? null
                : JsonSerializer.SerializeToElement(payload, BridgeSerializer.Default),
        });
        var responseJson = await _dispatcher.DispatchAsync(request);
        return JsonSerializer.Deserialize<JsonElement>(responseJson);
    }

    [Fact]
    public async Task ReadText_Returns_File_Content_Through_Dispatcher()
    {
        var path = Path.Combine(_dir, "hello.txt");
        await File.WriteAllTextAsync(path, "contents");

        var response = await InvokeAsync("readText", new { path });

        response.GetProperty("success").GetBoolean().Should().BeTrue();
        response.GetProperty("data").GetProperty("content").GetString().Should().Be("contents");
    }

    [Fact]
    public async Task WriteText_Creates_File()
    {
        var path = Path.Combine(_dir, "created.txt");

        var response = await InvokeAsync("writeText", new { path, content = "written" });

        response.GetProperty("success").GetBoolean().Should().BeTrue();
        response.GetProperty("data").GetProperty("success").GetBoolean().Should().BeTrue();
        (await File.ReadAllTextAsync(path)).Should().Be("written");
    }

    [Fact]
    public async Task Exists_Returns_True_For_Present_File()
    {
        var path = Path.Combine(_dir, "here.txt");
        await File.WriteAllTextAsync(path, "");

        var response = await InvokeAsync("exists", new { path });
        response.GetProperty("data").GetProperty("exists").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task Exists_Returns_False_For_Missing_File()
    {
        var response = await InvokeAsync("exists", new { path = Path.Combine(_dir, "nope.txt") });
        response.GetProperty("data").GetProperty("exists").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task Delete_Removes_File()
    {
        var path = Path.Combine(_dir, "victim.txt");
        await File.WriteAllTextAsync(path, "");

        var response = await InvokeAsync("delete", new { path });
        response.GetProperty("success").GetBoolean().Should().BeTrue();
        File.Exists(path).Should().BeFalse();
    }

    [Fact]
    public async Task ListDirectory_Returns_Files_And_Subdirectories()
    {
        await File.WriteAllTextAsync(Path.Combine(_dir, "a.txt"), "");
        Directory.CreateDirectory(Path.Combine(_dir, "sub"));

        var response = await InvokeAsync("listDirectory", new { path = _dir });

        var entries = response.GetProperty("data").GetProperty("entries").EnumerateArray().ToList();
        entries.Should().HaveCount(2);

        var byName = entries.ToDictionary(e => e.GetProperty("name").GetString()!);
        byName["a.txt"].GetProperty("isDirectory").GetBoolean().Should().BeFalse();
        byName["sub"].GetProperty("isDirectory").GetBoolean().Should().BeTrue();
    }

    [Fact]
    public async Task ReadText_On_Missing_File_Surfaces_As_ModuleError()
    {
        var response = await InvokeAsync("readText", new { path = Path.Combine(_dir, "nope.txt") });
        response.GetProperty("success").GetBoolean().Should().BeFalse();
        response.GetProperty("error").GetProperty("code").GetString().Should().Be("NATIVE_MEMBER_ERROR");
    }
}
