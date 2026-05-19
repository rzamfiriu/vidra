using Vidra.Bridge;

namespace Vidra.Bridge.Tests;

public record EchoPayload(string Text);
public record EchoResult(string Text);

[BridgeModule("echo")]
public sealed class EchoModule : BridgeModuleBase
{
    [BridgeMethod("ping")]
    public Task<EchoResult> PingAsync(EchoPayload args, CancellationToken ct)
        => Task.FromResult(new EchoResult(args.Text));

    [BridgeMethod("fail")]
    public Task FailAsync(CancellationToken ct)
        => Task.FromException(new InvalidOperationException("boom"));

    [BridgeMethod("defaults")]
    public Task<int> DefaultsAsync(int count = 7, CancellationToken ct = default)
        => Task.FromResult(count);

    [BridgeMethod("fireAndForget")]
    public Task FireAndForgetAsync(CancellationToken ct)
    {
        // Use an explicit non-generic Task so the dispatcher follows the
        // "return null" branch instead of unwrapping a Task<VoidTaskResult>.
        var tcs = new TaskCompletionSource();
        tcs.SetResult();
        return tcs.Task;
    }
}

/// <summary>
/// Deliberately exercises a module without a BridgeModule attribute
/// to ensure BridgeModuleBase validates its decoration.
/// </summary>
public sealed class UnattributedModule : BridgeModuleBase
{
    [BridgeMethod("noop")]
    public Task NoopAsync(CancellationToken ct) => Task.CompletedTask;
}
