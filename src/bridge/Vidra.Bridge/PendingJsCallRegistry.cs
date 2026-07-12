using System.Collections.Concurrent;

namespace Vidra.Bridge;

internal sealed class PendingJsCallRegistry
{
    private readonly ConcurrentDictionary<string, TaskCompletionSource<string>> _pending = new();
    private int _idCounter;

    internal int Count => _pending.Count;

    internal PendingJsCall Create(string contract, string member)
    {
        var id = $"js_{Interlocked.Increment(ref _idCounter)}_{Environment.TickCount64}";
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(id, completion))
            throw new InvalidOperationException($"Duplicate JavaScript call correlation id '{id}'.");
        return new PendingJsCall(id, contract, member, completion.Task);
    }

    internal bool TryComplete(string id, string responseJson)
        => _pending.TryRemove(id, out var completion)
           && completion.TrySetResult(responseJson);

    internal void Remove(string id)
        => _pending.TryRemove(id, out _);

    internal async Task<string> WaitAsync(
        PendingJsCall call,
        TimeSpan timeout,
        CancellationToken ct)
    {
        try
        {
            return await call.Response.WaitAsync(timeout, ct);
        }
        catch (TimeoutException)
        {
            throw new JsContractTimeoutException(call.Contract, call.Member, timeout);
        }
        finally
        {
            _pending.TryRemove(call.Id, out _);
        }
    }
}

internal sealed record PendingJsCall(
    string Id,
    string Contract,
    string Member,
    Task<string> Response);
