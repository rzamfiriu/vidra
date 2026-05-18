using System.Text.Json;
using UINet.Bridge;

namespace UINet.Bridge.Tests;

/// <summary>
/// Drives the bridge against the JSON fixtures shared with the TypeScript SDK.
/// Any change to the wire format must update both the fixture and the TS side.
/// </summary>
public sealed class ContractFixtureTests
{
    private static readonly string FixturesDir = Path.Combine(
        AppContext.BaseDirectory, "contract", "fixtures");

    private static string ReadFixture(string name)
        => File.ReadAllText(Path.Combine(FixturesDir, name));

    private static JsonElement AsElement(string json)
        => JsonSerializer.Deserialize<JsonElement>(json);

    private static async Task<JsonElement> DispatchAsync(BridgeDispatcher dispatcher, string requestFixture)
    {
        var requestJson = ReadFixture(requestFixture);
        var responseJson = await dispatcher.DispatchAsync(requestJson);
        return AsElement(responseJson);
    }

    [Fact]
    public async Task Invoke_Success_Matches_Fixture()
    {
        var dispatcher = new BridgeDispatcher();
        dispatcher.Register(new EchoModule());

        var actual = await DispatchAsync(dispatcher, "invoke.success.request.json");
        var expected = AsElement(ReadFixture("invoke.success.response.json"));

        actual.GetProperty("id").GetString().Should().Be(expected.GetProperty("id").GetString());
        actual.GetProperty("success").GetBoolean().Should().BeTrue();
        actual.GetProperty("data").GetProperty("text").GetString()
            .Should().Be(expected.GetProperty("data").GetProperty("text").GetString());
    }

    [Fact]
    public async Task Invoke_ModuleNotFound_Matches_Fixture()
    {
        var dispatcher = new BridgeDispatcher();

        var actual = await DispatchAsync(dispatcher, "invoke.module_not_found.request.json");
        var expected = AsElement(ReadFixture("invoke.module_not_found.response.json"));

        actual.GetProperty("id").GetString().Should().Be(expected.GetProperty("id").GetString());
        actual.GetProperty("success").GetBoolean().Should().BeFalse();
        actual.GetProperty("error").GetProperty("code").GetString()
            .Should().Be(expected.GetProperty("error").GetProperty("code").GetString());
        actual.GetProperty("error").GetProperty("message").GetString()
            .Should().Be(expected.GetProperty("error").GetProperty("message").GetString());
    }

    [Fact]
    public async Task Invoke_ModuleError_Matches_Fixture()
    {
        var dispatcher = new BridgeDispatcher();
        dispatcher.Register(new EchoModule());

        var actual = await DispatchAsync(dispatcher, "invoke.module_error.request.json");
        var expected = AsElement(ReadFixture("invoke.module_error.response.json"));

        actual.GetProperty("id").GetString().Should().Be(expected.GetProperty("id").GetString());
        actual.GetProperty("success").GetBoolean().Should().BeFalse();
        actual.GetProperty("error").GetProperty("code").GetString()
            .Should().Be(expected.GetProperty("error").GetProperty("code").GetString());
        actual.GetProperty("error").GetProperty("message").GetString()
            .Should().Be(expected.GetProperty("error").GetProperty("message").GetString());
    }

    [Fact]
    public async Task Invoke_ParseError_Matches_Fixture_Shape()
    {
        var dispatcher = new BridgeDispatcher();

        var responseJson = await dispatcher.DispatchAsync("not valid json");
        var actual = AsElement(responseJson);
        var expected = AsElement(ReadFixture("invoke.parse_error.response.json"));

        actual.GetProperty("id").GetString().Should().Be(expected.GetProperty("id").GetString());
        actual.GetProperty("success").GetBoolean().Should().BeFalse();
        actual.GetProperty("error").GetProperty("code").GetString()
            .Should().Be(expected.GetProperty("error").GetProperty("code").GetString());
    }

    [Fact]
    public async Task Capabilities_Fixture_Matches_Dispatcher_Shape()
    {
        var dispatcher = new BridgeDispatcher();
        dispatcher.Register(new EchoOnlyModule());

        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = "cap_1",
            Module = "__bridge",
            Method = "capabilities",
        });

        var response = AsElement(await dispatcher.DispatchAsync(request));
        var expected = AsElement(ReadFixture("capabilities.response.json"));

        response.GetProperty("id").GetString().Should().Be(expected.GetProperty("id").GetString());
        response.GetProperty("success").GetBoolean().Should().BeTrue();

        var actualEcho = response.GetProperty("data").GetProperty("echo");
        var expectedEcho = expected.GetProperty("data").GetProperty("echo");

        var actualMethods = actualEcho.EnumerateArray().Select(e => e.GetString()).ToHashSet();
        var expectedMethods = expectedEcho.EnumerateArray().Select(e => e.GetString()).ToHashSet();
        actualMethods.Should().BeEquivalentTo(expectedMethods);
    }

    [Fact]
    public void Event_Fixture_Roundtrips_Through_BridgeEvent()
    {
        var raw = ReadFixture("event.app_resume.json");
        var ev = BridgeSerializer.Deserialize<BridgeEvent>(raw);
        ev!.Event.Should().Be("app.resume");
    }

    [Fact]
    public void Reverse_Fixtures_Roundtrip_Through_ReverseRequest_And_Response()
    {
        var req = BridgeSerializer.Deserialize<ReverseRequest>(ReadFixture("reverse.success.request.json"));
        req!.Handler.Should().Be("confirm");
        req.Id.Should().Be("rev_1");

        var success = BridgeSerializer.Deserialize<ReverseResponse>(ReadFixture("reverse.success.response.json"));
        success!.Success.Should().BeTrue();
        success.Data!.Value.GetBoolean().Should().BeTrue();

        var notFound = BridgeSerializer.Deserialize<ReverseResponse>(ReadFixture("reverse.handler_not_found.response.json"));
        notFound!.Success.Should().BeFalse();
        notFound.Error!.Code.Should().Be("HANDLER_NOT_FOUND");

        var errored = BridgeSerializer.Deserialize<ReverseResponse>(ReadFixture("reverse.handler_error.response.json"));
        errored!.Success.Should().BeFalse();
        errored.Error!.Code.Should().Be("HANDLER_ERROR");
    }

    // The capabilities fixture advertises only the `ping` and `fail` methods.
    // We model a trimmed-down module so the shape matches exactly without
    // cross-cutting the richer EchoModule used elsewhere.
    [BridgeModule("echo")]
    private sealed class EchoOnlyModule : BridgeModuleBase
    {
        [BridgeMethod("ping")]
        public Task<EchoResult> PingAsync(EchoPayload args, CancellationToken ct)
            => Task.FromResult(new EchoResult(args.Text));

        [BridgeMethod("fail")]
        public Task FailAsync(CancellationToken ct)
            => Task.FromException(new InvalidOperationException("boom"));
    }
}
