using System.Text.Json;
using Vidra.Bridge;

namespace Vidra.Bridge.Tests;

public sealed class BridgeModuleBaseTests
{
    [Fact]
    public void Constructor_Throws_When_BridgeModule_Attribute_Missing()
    {
        Action act = () => _ = new UnattributedModule();
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*BridgeModule*");
    }

    [Fact]
    public void ModuleName_Reflects_Attribute_Value()
    {
        var module = new EchoModule();
        module.ModuleName.Should().Be("echo");
    }

    [Fact]
    public void SupportedMethods_Includes_All_Attributed_Methods()
    {
        var module = new EchoModule();
        module.SupportedMethods.Should().BeEquivalentTo(new[]
        {
            "ping", "fail", "defaults", "fireAndForget"
        });
    }

    [Fact]
    public async Task HandleAsync_Method_Lookup_Is_Case_Insensitive()
    {
        var module = new EchoModule();
        var payload = new JsonPayload(JsonSerializer.SerializeToElement(new { text = "x" }, BridgeSerializer.Default));

        var resultMixedCase = await module.HandleAsync("Ping", payload, CancellationToken.None);
        resultMixedCase.Should().BeOfType<EchoResult>().Which.Text.Should().Be("x");
    }

    [Fact]
    public async Task HandleAsync_Unwraps_Task_Result()
    {
        var module = new EchoModule();
        var payload = new JsonPayload(JsonSerializer.SerializeToElement(new { text = "ok" }, BridgeSerializer.Default));

        var result = await module.HandleAsync("ping", payload, CancellationToken.None);
        result.Should().BeOfType<EchoResult>();
        ((EchoResult)result!).Text.Should().Be("ok");
    }

    [Fact]
    public async Task HandleAsync_Non_Generic_Task_Returns_Null()
    {
        var module = new EchoModule();
        var result = await module.HandleAsync("fireAndForget", null, CancellationToken.None);
        result.Should().BeNull();
    }

    [Fact]
    public async Task HandleAsync_Uses_Default_Value_When_Payload_Missing()
    {
        var module = new EchoModule();
        var result = await module.HandleAsync("defaults", null, CancellationToken.None);
        result.Should().Be(7);
    }

    [Fact]
    public async Task HandleAsync_Throws_NotSupported_For_Unknown_Method()
    {
        var module = new EchoModule();
        Func<Task> act = () => module.HandleAsync("missing", null, CancellationToken.None);
        await act.Should().ThrowAsync<NotSupportedException>();
    }

    [Fact]
    public async Task HandleAsync_Passes_CancellationToken_Argument()
    {
        var module = new TokenCapturingModule();
        using var cts = new CancellationTokenSource();

        await module.HandleAsync("run", null, cts.Token);

        module.CapturedToken.Should().Be(cts.Token);
    }

    [BridgeModule("token")]
    private sealed class TokenCapturingModule : BridgeModuleBase
    {
        public CancellationToken CapturedToken { get; private set; }

        [BridgeMethod("run")]
        public Task RunAsync(CancellationToken ct)
        {
            CapturedToken = ct;
            return Task.CompletedTask;
        }
    }
}
