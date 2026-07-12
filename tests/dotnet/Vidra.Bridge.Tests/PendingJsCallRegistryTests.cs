using Vidra.Bridge;

namespace Vidra.Bridge.Tests;

public sealed class PendingJsCallRegistryTests
{
    [Fact]
    public async Task WaitAsync_Completes_And_Removes_Correlation()
    {
        var registry = new PendingJsCallRegistry();
        var call = registry.Create("counter", "increment");

        registry.TryComplete(call.Id, """{"id":"ok"}""").Should().BeTrue();
        var response = await registry.WaitAsync(call, TimeSpan.FromSeconds(1), CancellationToken.None);

        response.Should().Contain("\"ok\"");
        registry.Count.Should().Be(0);
    }

    [Fact]
    public async Task WaitAsync_Times_Out_And_Removes_Correlation()
    {
        var registry = new PendingJsCallRegistry();
        var call = registry.Create("counter", "increment");

        var act = () => registry.WaitAsync(call, TimeSpan.FromMilliseconds(1), CancellationToken.None);

        var error = await act.Should().ThrowAsync<JsContractTimeoutException>();
        error.Which.Contract.Should().Be("counter");
        error.Which.Member.Should().Be("increment");
        registry.Count.Should().Be(0);
        registry.TryComplete(call.Id, "{}").Should().BeFalse("late responses are orphaned");
    }

    [Fact]
    public async Task WaitAsync_Cancellation_Removes_Correlation()
    {
        var registry = new PendingJsCallRegistry();
        var call = registry.Create("counter", "increment");
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        var act = () => registry.WaitAsync(call, TimeSpan.FromSeconds(1), cts.Token);

        await act.Should().ThrowAsync<OperationCanceledException>();
        registry.Count.Should().Be(0);
    }
}
