using Microsoft.Maui.Storage;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials;

public record FilePickerPickArgs(string? Title);

public record PickedFile(string FileName, string FullPath, string? ContentType);

public record FilePickerPickOneResult(PickedFile? File);
public record FilePickerPickMultipleResult(PickedFile[] Files);

/// <summary>
/// Native open-file dialogs via MAUI Essentials <see cref="FilePicker"/>.
/// Returns metadata only (path + name + content type); read file contents
/// through the <c>filesystem</c> module using the returned <c>fullPath</c>.
/// </summary>
[BridgeModule("filePicker")]
public sealed class FilePickerModule : BridgeModuleBase
{
    [BridgeMethod("pickOne")]
    public async Task<FilePickerPickOneResult> PickOneAsync(FilePickerPickArgs args, CancellationToken ct)
    {
        var result = await FilePicker.Default.PickAsync(BuildOptions(args));
        return new FilePickerPickOneResult(
            result is null ? null : await ToPickedFileAsync(result, ct));
    }

    [BridgeMethod("pickMultiple")]
    public async Task<FilePickerPickMultipleResult> PickMultipleAsync(FilePickerPickArgs args, CancellationToken ct)
    {
        var results = await FilePicker.Default.PickMultipleAsync(BuildOptions(args));
        var files = new List<PickedFile>();
        foreach (var result in results ?? [])
        {
            if (result is not null)
                files.Add(await ToPickedFileAsync(result, ct));
        }

        return new FilePickerPickMultipleResult([.. files]);
    }

    private static PickOptions? BuildOptions(FilePickerPickArgs args)
        => string.IsNullOrEmpty(args.Title) ? null : new PickOptions { PickerTitle = args.Title };

    private static async Task<PickedFile> ToPickedFileAsync(
        FileResult result,
        CancellationToken ct)
    {
#if ANDROID
        // Android's picker commonly returns a content:// URI, which is not a
        // filesystem path and cannot safely be handed to the path-based bridge.
        // Copy it into Vidra's app-scoped cache and return that real path.
        var directory = Path.Combine(FileSystem.Current.CacheDirectory, "picked-files");
        Directory.CreateDirectory(directory);
        PrunePickedFiles(directory);
        var safeName = Path.GetFileName(result.FileName);
        var destination = Path.Combine(directory, $"{Guid.NewGuid():N}-{safeName}");

        await using var source = await result.OpenReadAsync();
        await using var output = File.Create(destination);
        await source.CopyToAsync(output, ct);
        return new PickedFile(result.FileName, destination, result.ContentType);
#else
        await Task.CompletedTask;
        return new PickedFile(result.FileName, result.FullPath, result.ContentType);
#endif
    }

#if ANDROID
    private static void PrunePickedFiles(string directory)
    {
        try
        {
            var cutoff = DateTime.UtcNow - TimeSpan.FromDays(1);
            var files = new DirectoryInfo(directory)
                .EnumerateFiles()
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .ToArray();
            var stale = files
                .Skip(31)
                .Concat(files.Where(file => file.LastWriteTimeUtc < cutoff))
                .DistinctBy(file => file.FullName);

            foreach (var file in stale)
                file.Delete();
        }
        catch (IOException)
        {
            // Cache cleanup is best effort; a concurrently opened or removed
            // picker copy must not turn a successful pick into a failure.
        }
        catch (UnauthorizedAccessException)
        {
            // The selected file can still be copied even when stale cleanup is
            // temporarily denied by the platform.
        }
    }
#endif
}
