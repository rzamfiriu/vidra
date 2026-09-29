# Vidra.Modules.Essentials

MAUI Essentials bridge contracts for [Vidra](https://vidra.build), including
device information, sharing, browser/launcher access, file picking, speech,
connectivity, battery, preferences, and secure storage.

On Android, the system picker returns `content://` values rather than ordinary
paths. Vidra copies each selected file into `cache/picked-files` and returns that
app-scoped path. Grant the filesystem `cache` root if JavaScript needs to read
the selected file. Copies are temporary: entries older than one day and copies
beyond the newest 32 are pruned on later picks, and Android may clear cache
earlier.

Use `essentials.getSupport()` before presenting capabilities that depend on
installed applications or services.

[NuGet](https://www.nuget.org/packages/Vidra.Modules.Essentials) ·
[GitHub](https://github.com/rzamfiriu/vidra)
