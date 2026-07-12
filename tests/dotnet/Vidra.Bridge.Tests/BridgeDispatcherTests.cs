using System.Text.Json;
using Vidra.Bridge;

namespace Vidra.Bridge.Tests;

public sealed class BridgeDispatcherTests
{
    private static BridgeDispatcher CreateDispatcher(params IBridgeModule[] modules)
    {
        var dispatcher = new BridgeDispatcher();
        foreach (var module in modules)
            dispatcher.Register(module);
        return dispatcher;
    }

    private static BridgeResponse Deserialize(string json)
        => BridgeSerializer.Deserialize<BridgeResponse>(json)!;

    [Fact]
    public async Task DispatchAsync_Returns_Success_On_Known_Module()
    {
        var dispatcher = CreateDispatcher(new EchoModule());
        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = "req_1",
            Contract = "echo",
            Member = "ping",
            Payload = JsonSerializer.SerializeToElement(new { text = "hi" }, BridgeSerializer.Default),
        });

        var responseJson = await dispatcher.DispatchAsync(request);

        var response = Deserialize(responseJson);
        response.Id.Should().Be("req_1");
        response.Success.Should().BeTrue();
        response.Error.Should().BeNull();

        // Data is serialized as camelCase JSON
        var data = JsonSerializer.Serialize(response.Data, BridgeSerializer.Default);
        data.Should().Contain("\"text\":\"hi\"");
    }

    [Fact]
    public async Task DispatchAsync_Matches_Module_Name_Case_Insensitively()
    {
        var dispatcher = CreateDispatcher(new EchoModule());
        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = "req_2",
            Contract = "ECHO",
            Member = "ping",
            Payload = JsonSerializer.SerializeToElement(new { text = "yo" }, BridgeSerializer.Default),
        });

        var response = Deserialize(await dispatcher.DispatchAsync(request));
        response.Success.Should().BeTrue();
    }

    [Fact]
    public async Task DispatchAsync_Returns_ModuleNotFound_For_Unknown_Module()
    {
        var dispatcher = CreateDispatcher();
        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = "req_3",
            Contract = "missing",
            Member = "noop",
        });

        var response = Deserialize(await dispatcher.DispatchAsync(request));
        response.Id.Should().Be("req_3");
        response.Success.Should().BeFalse();
        response.Error!.Code.Should().Be("NATIVE_CONTRACT_NOT_FOUND");
        response.Error.Message.Should().Contain("missing");
    }

    [Fact]
    public async Task DispatchAsync_Returns_ParseError_On_Invalid_Json()
    {
        var dispatcher = CreateDispatcher();

        var response = Deserialize(await dispatcher.DispatchAsync("not-valid-json"));
        response.Id.Should().Be("unknown");
        response.Success.Should().BeFalse();
        response.Error!.Code.Should().Be("PARSE_ERROR");
    }

    [Fact]
    public async Task DispatchAsync_Returns_ParseError_When_Payload_Is_Null()
    {
        var dispatcher = CreateDispatcher();

        var response = Deserialize(await dispatcher.DispatchAsync("null"));
        response.Success.Should().BeFalse();
        response.Error!.Code.Should().Be("PARSE_ERROR");
    }

    [Fact]
    public async Task DispatchAsync_Wraps_Module_Exceptions_As_ModuleError()
    {
        var dispatcher = CreateDispatcher(new EchoModule());
        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = "req_4",
            Contract = "echo",
            Member = "fail",
        });

        var response = Deserialize(await dispatcher.DispatchAsync(request));
        response.Success.Should().BeFalse();
        response.Error!.Code.Should().Be("NATIVE_MEMBER_ERROR");
        response.Error.Message.Should().Be("boom");
    }

    [Fact]
    public async Task DispatchAsync_Returns_Capabilities_For_Reserved_Module()
    {
        var dispatcher = CreateDispatcher(new EchoModule());
        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = "cap_1",
            Contract = "__bridge",
            Member = "capabilities",
        });

        var response = Deserialize(await dispatcher.DispatchAsync(request));
        response.Success.Should().BeTrue();

        var caps = JsonSerializer.Serialize(response.Data, BridgeSerializer.Default);
        caps.Should().Contain("\"echo\"");
        caps.Should().Contain("\"ping\"");
        caps.Should().Contain("\"fail\"");
    }

    [Fact]
    public void GetCapabilities_Lists_All_Registered_Modules_And_Methods()
    {
        var dispatcher = CreateDispatcher(new EchoModule());
        var caps = dispatcher.GetCapabilities();

        caps.ProtocolVersion.Should().Be(BridgeProtocol.Version);
        caps.NativeContracts.Should().ContainKey("echo");
        caps.NativeContracts["echo"].Methods
            .Should().Contain(new[] { "ping", "fail", "defaults", "fireAndForget" });
    }

    [Fact]
    public void GetCapabilities_Merges_Event_Only_Contracts()
    {
        var dispatcher = CreateDispatcher();
        dispatcher.RegisterEvents("runtime", "hotReloaded");

        var caps = dispatcher.GetCapabilities();

        caps.NativeContracts["runtime"].Methods.Should().BeEmpty();
        caps.NativeContracts["runtime"].Events.Should().Equal("hotReloaded");
    }

    [Fact]
    public async Task DispatchAsync_Last_Register_Wins_For_Duplicate_Module_Names()
    {
        var dispatcher = new BridgeDispatcher();
        dispatcher.Register(new EchoModule());
        dispatcher.Register(new EchoModule());

        var caps = dispatcher.GetCapabilities();
        caps.NativeContracts.Should().HaveCount(1);
    }
}
