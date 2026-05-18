using UINet.Bridge;

namespace UINet.Modules.FileSystem;

public record ReadTextArgs(string Path);
public record ReadTextResult(string Content);

public record WriteTextArgs(string Path, string Content);
public record WriteTextResult(bool Success);

public record ExistsArgs(string Path);
public record ExistsResult(bool Exists);

public record DeleteArgs(string Path);
public record DeleteResult(bool Success);

public record ListDirectoryArgs(string Path);
public record DirectoryEntry(string Name, bool IsDirectory);
public record ListDirectoryResult(List<DirectoryEntry> Entries);

[BridgeModule("filesystem")]
public sealed class FileSystemModule : BridgeModuleBase
{
    [BridgeMethod("readText")]
    public async Task<ReadTextResult> ReadTextAsync(ReadTextArgs args, CancellationToken ct)
    {
        var content = await File.ReadAllTextAsync(args.Path, ct);
        return new ReadTextResult(content);
    }

    [BridgeMethod("writeText")]
    public async Task<WriteTextResult> WriteTextAsync(WriteTextArgs args, CancellationToken ct)
    {
        await File.WriteAllTextAsync(args.Path, args.Content, ct);
        return new WriteTextResult(true);
    }

    [BridgeMethod("exists")]
    public Task<ExistsResult> ExistsAsync(ExistsArgs args, CancellationToken ct)
    {
        return Task.FromResult(new ExistsResult(File.Exists(args.Path)));
    }

    [BridgeMethod("delete")]
    public Task<DeleteResult> DeleteAsync(DeleteArgs args, CancellationToken ct)
    {
        File.Delete(args.Path);
        return Task.FromResult(new DeleteResult(true));
    }

    [BridgeMethod("listDirectory")]
    public Task<ListDirectoryResult> ListDirectoryAsync(ListDirectoryArgs args, CancellationToken ct)
    {
        var entries = Directory.GetFileSystemEntries(args.Path)
            .Select(e => new DirectoryEntry(Path.GetFileName(e), Directory.Exists(e)))
            .ToList();
        return Task.FromResult(new ListDirectoryResult(entries));
    }
}
