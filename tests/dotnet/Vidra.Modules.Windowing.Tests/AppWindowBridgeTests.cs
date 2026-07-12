using System.Text.Json;
using Vidra.Bridge;
using Vidra.Modules.Windowing;

namespace Vidra.Modules.Windowing.Tests;

public sealed class AppWindowAttributeTests
{
    [Fact]
    public void Module_Advertises_Expected_Name()
    {
        var module = new TestAppWindowModule(new FakeAppWindowService());
        module.ModuleName.Should().Be("appWindow");
    }

    [Fact]
    public void Module_Exposes_Expected_Methods()
    {
        var module = new TestAppWindowModule(new FakeAppWindowService());
        module.SupportedMethods.Should().BeEquivalentTo(new[]
        {
            "getSupport", "getCurrent", "configure", "setTitle", "setSize",
            "center", "maximize", "minimize", "restore", "setFullscreen",
        });
    }

    [Fact]
    public void AppWindowEvents_Contains_Expected_Identifiers()
    {
        AppWindowEvents.Resized.Contract.Should().Be("appWindow");
        AppWindowEvents.Resized.Member.Should().Be("resized");
        AppWindowEvents.StateChanged.Member.Should().Be("stateChanged");
    }
}

public sealed class AppWindowBridgeTests
{
    private readonly FakeAppWindowService _service = new();
    private readonly BridgeDispatcher _dispatcher;

    public AppWindowBridgeTests()
    {
        _dispatcher = new BridgeDispatcher();
        _dispatcher.Register(new TestAppWindowModule(_service));
    }

    private async Task<JsonElement> InvokeAsync(string method, object? payload)
    {
        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = Guid.NewGuid().ToString("N"),
            Contract = "appWindow",
            Member = method,
            Payload = payload is null
                ? null
                : JsonSerializer.SerializeToElement(payload, BridgeSerializer.Default),
        });
        var responseJson = await _dispatcher.DispatchAsync(request);
        return JsonSerializer.Deserialize<JsonElement>(responseJson);
    }

    [Fact]
    public async Task GetCurrent_Roundtrips_WindowInfo_As_CamelCase_Json()
    {
        _service.Current = new WindowInfo("Example", 1280, 720, WindowState.Maximized);

        var response = await InvokeAsync("getCurrent", payload: null);

        response.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = response.GetProperty("data");
        data.GetProperty("title").GetString().Should().Be("Example");
        data.GetProperty("width").GetDouble().Should().Be(1280);
        data.GetProperty("height").GetDouble().Should().Be(720);
        // BridgeSerializer registers JsonStringEnumConverter(CamelCase), so
        // WindowState crosses the wire as the camelCase string union member
        // that the generated TypeScript proxy declares.
        data.GetProperty("state").GetString().Should().Be("maximized");
    }

    [Fact]
    public async Task GetSupport_Roundtrips_WindowSupport_As_CamelCase_Json()
    {
        _service.Support = new WindowSupport("mac", true, true, true, true, false, false, false, false, false);

        var response = await InvokeAsync("getSupport", payload: null);
        var data = response.GetProperty("data");

        data.GetProperty("platform").GetString().Should().Be("mac");
        data.GetProperty("getCurrent").GetBoolean().Should().BeTrue();
        data.GetProperty("maximize").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task SetSize_Rejects_Non_Positive_Dimensions_As_ModuleError()
    {
        // The module throws synchronously from DimensionValidation before any
        // await, so reflection-invoke wraps the exception in a
        // TargetInvocationException. The dispatcher surfaces it as
        // NATIVE_MEMBER_ERROR without unwrapping the inner message; we assert the
        // observable behavior, not the wrapper message.
        var response = await InvokeAsync("setSize", new { width = 0, height = 100 });
        response.GetProperty("success").GetBoolean().Should().BeFalse();
        response.GetProperty("error").GetProperty("code").GetString().Should().Be("NATIVE_MEMBER_ERROR");
    }

    [Fact]
    public async Task Configure_Accepts_Null_Dimensions()
    {
        var response = await InvokeAsync("configure", new { title = "new" });
        response.GetProperty("success").GetBoolean().Should().BeTrue();
        response.GetProperty("data").GetProperty("title").GetString().Should().Be("new");
    }

    [Fact]
    public async Task Configure_Rejects_Negative_Width_With_ModuleError()
    {
        var response = await InvokeAsync("configure", new { width = -10 });
        response.GetProperty("success").GetBoolean().Should().BeFalse();
        response.GetProperty("error").GetProperty("code").GetString().Should().Be("NATIVE_MEMBER_ERROR");
    }
}
