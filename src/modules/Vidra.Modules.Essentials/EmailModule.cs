using Microsoft.Maui.ApplicationModel.Communication;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public record EmailComposeArgs(
    string? Subject,
    string? Body,
    string[]? To,
    string[]? Cc,
    string[]? Bcc
);

public record EmailComposeResult(bool Success);

/// <summary>
/// Opens the platform email composer via MAUI Essentials <see cref="Email"/>.
/// Requires a configured mail client; gate on <c>essentials.getSupport</c>.
/// </summary>
[BridgeModule("email")]
public sealed class EmailModule : BridgeModuleBase
{
    [BridgeMethod("compose")]
    public async Task<EmailComposeResult> ComposeAsync(EmailComposeArgs args, CancellationToken ct)
    {
        if (!Email.Default.IsComposeSupported)
            throw new InvalidOperationException("Email composition is not supported on this device.");

        var message = new EmailMessage
        {
            Subject = args.Subject ?? string.Empty,
            Body = args.Body ?? string.Empty,
            To = args.To?.ToList() ?? new List<string>(),
            Cc = args.Cc?.ToList() ?? new List<string>(),
            Bcc = args.Bcc?.ToList() ?? new List<string>(),
        };

        await Email.Default.ComposeAsync(message);
        return new EmailComposeResult(true);
    }
}
