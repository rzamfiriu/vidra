using System.Security.Cryptography;
using System.Text;

namespace Vidra.CodeGen.Model;

public enum ContractMemberKind
{
    NativeMethod,
    Event,
    JsMethod,
}

public sealed class ContractEntry
{
    public string Contract { get; set; } = string.Empty;
    public string Member { get; set; } = string.Empty;
    public ContractMemberKind Kind { get; set; }
    public string? PayloadSchema { get; set; }
    public string? ResultSchema { get; set; }
}

public static class ContractFingerprint
{
    public static string Canonicalize(IEnumerable<ContractEntry> entries)
    {
        return string.Join(
            "\n",
            entries
                .OrderBy(entry => entry.Contract, StringComparer.Ordinal)
                .ThenBy(entry => entry.Kind)
                .ThenBy(entry => entry.Member, StringComparer.Ordinal)
                .Select(entry =>
                    $"{entry.Contract}|{entry.Kind}|{entry.Member}|{entry.PayloadSchema ?? "-"}|{entry.ResultSchema ?? "-"}"));
    }

    public static string Compute(IEnumerable<ContractEntry> entries)
    {
        var canonical = Canonicalize(entries);
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(canonical));
        return BitConverter.ToString(bytes).Replace("-", string.Empty).ToLowerInvariant();
    }
}
