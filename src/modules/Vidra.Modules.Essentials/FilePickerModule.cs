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
        return new FilePickerPickOneResult(result is null ? null : ToPickedFile(result));
    }

    [BridgeMethod("pickMultiple")]
    public async Task<FilePickerPickMultipleResult> PickMultipleAsync(FilePickerPickArgs args, CancellationToken ct)
    {
        var results = await FilePicker.Default.PickMultipleAsync(BuildOptions(args));
        var files = results?
            .Where(r => r is not null)
            .Select(r => ToPickedFile(r!))
            .ToArray() ?? Array.Empty<PickedFile>();
        return new FilePickerPickMultipleResult(files);
    }

    private static PickOptions? BuildOptions(FilePickerPickArgs args)
        => string.IsNullOrEmpty(args.Title) ? null : new PickOptions { PickerTitle = args.Title };

    private static PickedFile ToPickedFile(FileResult result)
        => new(result.FileName, result.FullPath, result.ContentType);
}
