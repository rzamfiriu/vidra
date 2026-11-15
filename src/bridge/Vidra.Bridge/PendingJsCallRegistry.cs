using System.Collections.Concurrent;

namespace Vidra.Bridge;

internal sealed class PendingJsCallRegistry
{
    private readonly ConcurrentDictionary<string, Entry> _pending = new();
    private int _idCounter;

    internal int Count => _pending.Count;

    internal PendingJsCall Create(string contract, string member)
    {
        var id = $"js_{Interlocked.Increment(ref _idCounter)}_{Environment.TickCount64}";
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        if (!_pending.TryAdd(id, new Entry(completion, contract, member)))
            throw new InvalidOperationException($"Duplicate JavaScript call correlation id '{id}'.");
        return new PendingJsCall(id, contract, member, completion.Task);
    }

    internal bool TryComplete(string id, string responseJson)
        => _pending.TryRemove(id, out var entry)
           && entry.Completion.TrySetResult(responseJson);

    /// <summary>
    /// Fails every outstanding call with the error <paramref name="error"/>
    /// builds for it, and returns how many were failed. Used when the page that
    /// would have answered is gone, so nothing waits for a timeout that can only
    /// end one way.
    /// </summary>
    internal int FailAll(Func<string, string, Exception> error)
    {
        var failed = 0;
        foreach (var id in _pending.Keys)
        {
            if (_pending.TryRemove(id, out var entry)
                && entry.Completion.TrySetException(error(entry.Contract, entry.Member)))
            {
                failed++;
            }
        }
        return failed;
    }

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

    private sealed record Entry(
        TaskCompletionSource<string> Completion,
        string Contract,
        string Member);
}

internal sealed record PendingJsCall(
    string Id,
    string Contract,
    string Member,
    Task<string> Response);
