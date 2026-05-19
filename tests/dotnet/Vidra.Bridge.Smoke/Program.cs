using Vidra.Bridge;

namespace Vidra.Bridge.Smoke;

// Minimal C# harness used by the cross-platform smoke suite.
//
// The host language (Node, on Windows + macOS CI runners) spawns this exe
// and speaks line-delimited JSON over stdio:
//   - each line on stdin is a complete BridgeRequest payload;
//   - each line on stdout is the matching BridgeResponse payload.
// Exits cleanly on stdin EOF.
//
// Keeping this as net10.0 (non-MAUI) lets us validate the real C# bridge
// wire format on every OS in CI without needing the MAUI workload.
public static class Program
{
    public static async Task<int> Main()
    {
        var dispatcher = new BridgeDispatcher();
        dispatcher.Register(new EchoSmokeModule());

        Console.OutputEncoding = System.Text.Encoding.UTF8;
        var stdin = Console.In;

        while (true)
        {
            var line = await stdin.ReadLineAsync().ConfigureAwait(false);
            if (line is null) return 0;
            if (string.IsNullOrWhiteSpace(line)) continue;

            var response = await dispatcher.DispatchAsync(line).ConfigureAwait(false);
            await Console.Out.WriteLineAsync(response).ConfigureAwait(false);
            await Console.Out.FlushAsync().ConfigureAwait(false);
        }
    }
}

public sealed record EchoArgs(string Text);
public sealed record EchoResult(string Text, int Length);

[BridgeModule("echo")]
public sealed class EchoSmokeModule : BridgeModuleBase
{
    [BridgeMethod("ping")]
    public Task<EchoResult> PingAsync(EchoArgs args, CancellationToken ct)
    {
        if (args is null)
            throw new ArgumentException("ping requires a payload with 'text'.");
        return Task.FromResult(new EchoResult(args.Text, args.Text?.Length ?? 0));
    }
}
