using System.Text.Json;
using Vidra.Bridge;
using Vidra.Updates;

namespace Vidra.Hosting;

/// <summary>What the running app can say about its own updates.</summary>
public interface IVidraUpdates
{
    /// <summary>The bundle serving right now, or <see langword="null"/> for the embedded copy.</summary>
    string? CurrentBundle { get; }

    /// <summary>Version of the serving bundle.</summary>
    string? CurrentVersion { get; }

    /// <summary>A bundle downloaded and waiting for the next launch.</summary>
    string? PendingVersion { get; }

    /// <summary>
    /// The most recent check, or <see langword="null"/> if none has finished yet.
    /// </summary>
    /// <remarks>
    /// "Nothing was staged" and "the check has not come back" look identical
    /// without this — to an app deciding whether to show an update prompt, and to
    /// a test waiting for a verdict, which otherwise has no choice but to wait
    /// out its whole timeout on every negative case.
    /// </remarks>
    UpdateCheckResult? LastCheck { get; }

    /// <summary>Checks the feed now. Safe to call at any time; never throws for a network failure.</summary>
    Task<UpdateCheckResult> CheckNowAsync(CancellationToken ct = default);
}

/// <summary>
/// Ties the update client to the app lifecycle: decide what serves before the
/// WebView exists, clear probation when the bundle proves it boots, and look for
/// a newer one in the background.
/// </summary>
internal sealed class VidraUpdateService(VidraUpdateOptions options, IServiceProvider services) : IVidraUpdates
{
    private readonly BundleStore _store = new(FileSystem.AppDataDirectory);
    private UpdateState _state = UpdateState.Empty;
    private bool _configLoaded;
    private int _startupStarted;

    public string? CurrentBundle => _state.Current;

    public string? CurrentVersion => _state.CurrentVersion;

    public string? PendingVersion => _state.PendingVersion;

    public UpdateCheckResult? LastCheck { get; private set; }

    internal void StartAtLaunch()
    {
        if (Interlocked.Exchange(ref _startupStarted, 1) != 0)
            return;

        if (!string.IsNullOrEmpty(VidraRuntimeSettings.Get(VidraRuntimeSettings.DevUrl)))
        {
            Console.WriteLine("[vidra] update: skipped — this is a dev session");
            return;
        }

        ApplyStartupTransition();
        WatchForBoot();
        _ = RunStartupCheckAsync();
    }

    /// <summary>
    /// Runs before the first page is built. Promotion, rollback and choosing the
    /// asset root all have to happen here — once the WebView has loaded, changing
    /// its mind means a reload.
    /// </summary>
    public void ApplyStartupTransition()
    {
        try
        {
            _state = _store.LoadState();

            // Before anything is promoted: can *this* binary still serve what we
            // already have? Each bundle's fingerprints were checked when it was
            // selected from the feed, and a native update since then may have
            // moved the contracts underneath it.
            var (revalidated, dropped) = UpdateLifecycle.Revalidate(_state, RunningHost());
            if (dropped.Count > 0)
            {
                _state = revalidated;
                Log($"dropped {dropped.Count} bundle(s) built against different contracts: "
                    + string.Join(", ", dropped.Select(Short)));
            }

            var transition = UpdateLifecycle.OnStartup(_state);
            _state = UpdateLifecycle.ForgetUnreferenced(transition.State);

            if (transition.Outcome != StartupOutcome.Unchanged || dropped.Count > 0)
            {
                _store.SaveState(_state);
                _store.Prune(_state);
            }

            // Silent when nothing has ever been installed. Every Vidra app runs
            // this — the template wires updates up whether or not the app has a
            // feed — so an app that only ever serves its embedded bundle must
            // not narrate that on every launch. Anything that actually happened,
            // and any launch where a downloaded bundle is serving, still says so.
            if (transition.Outcome != StartupOutcome.Unchanged || dropped.Count > 0 || _state.Current is not null)
                Log($"{transition.Reason}");

            WebAssetRoot.UseResolver(() => _store.ResolveAssetRoot(_state));
        }
        catch (Exception ex)
        {
            // Anything unexpected here means serving the embedded copy, which is
            // always present. An app that will not start because of its updater
            // is worse than an app that missed an update.
            Log($"startup transition failed ({ex.Message}); serving the embedded bundle");
            WebAssetRoot.UseResolver(null);
        }
    }

    /// <summary>
    /// Called when the loaded bundle has proved it runs. Until this happens a
    /// promoted bundle is on probation and two silent launches roll it back.
    /// </summary>
    public void ConfirmBoot()
    {
        if (_state.Probation is null)
            return;

        try
        {
            _state = UpdateLifecycle.OnBootConfirmed(_state);
            _store.SaveState(_state);
            Log($"bundle {Short(_state.Current)} booted; probation cleared");
        }
        catch (Exception ex)
        {
            Log($"could not clear probation ({ex.Message}); the bundle may be rolled back unnecessarily");
        }
    }

    public async Task<UpdateCheckResult> CheckNowAsync(CancellationToken ct = default)
    {
        await LoadStampedConfigAsync().ConfigureAwait(false);

        if (!options.Enabled)
        {
            LastCheck = new UpdateCheckResult(UpdateCheckOutcome.NoUpdate, "updates are disabled");
            return LastCheck;
        }

        var source = ResolveSource();
        if (source is null)
        {
            LastCheck = new UpdateCheckResult(UpdateCheckOutcome.NoUpdate, "no update feed is configured");
            return LastCheck;
        }

        var request = new UpdateCheckRequest
        {
            // Read here rather than at construction: the contract registry is only
            // complete once the bridge has been materialised, and a fingerprint
            // read too early is a valid-looking hash of a partial manifest.
            CoreFingerprint = BridgeContractRegistry.Fingerprint(BridgeManifestScope.Core),
            AppFingerprint = BridgeContractRegistry.Fingerprint(BridgeManifestScope.App),
            AccessFingerprint = services.GetRequiredService<IBridgeAccessPolicy>().Fingerprint,
            EmbeddedVersion = EmbeddedVersion(),
            Channel = options.Channel ?? VidraRuntimeSettings.Get(VidraUpdateOptions.ChannelEnvironmentVariable),
            TrustedPublicKeys = [.. options.PublicKeys],
        };

        Log($"checking {source.Description} (core={Short(request.CoreFingerprint)} app={Short(request.AppFingerprint)})");

        if (request.TrustedPublicKeys.Count == 0)
        {
            // Said once per check, and deliberately blunt. An unsigned feed is a
            // reasonable choice for a private or local one and a serious mistake
            // for a public one, and the difference is not visible from here.
            Log("the feed is unsigned — anyone who can write to it can run code in this app");
        }

        var result = await new UpdateClient(_store).CheckAsync(source, request, ct).ConfigureAwait(false);

        if (result.State is not null)
            _state = result.State;

        LastCheck = result;
        Log(result.Reason);

        if (source is IDisposable disposable && !ReferenceEquals(source, options.Source))
            disposable.Dispose();

        return result;
    }

    public async Task RunStartupCheckAsync(CancellationToken ct = default)
    {
        if (!options.CheckOnStartup)
            return;

        await LoadStampedConfigAsync().ConfigureAwait(false);

        // An app that never configured a feed says nothing at all. Logging "no
        // update feed" on every launch of every app would train people to ignore
        // the line that matters.
        if (!options.Enabled || (options.Source is null && ConfiguredFeedUrl() is null))
            return;

        try
        {
            await Task.Delay(StartupDelay(), ct).ConfigureAwait(false);
            await CheckNowAsync(ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Log($"startup check failed: {ex.Message}");
        }
    }

    /// <summary>Subscribes to the signal that a bundle has proved itself.</summary>
    public void WatchForBoot()
    {
        var bridge = services.GetService<WebViewBridge>();
        if (bridge is null)
            return;

        bridge.BundleBooted += ConfirmBoot;
    }

    private TimeSpan StartupDelay()
        => int.TryParse(
            VidraRuntimeSettings.Get(VidraUpdateOptions.StartupDelayEnvironmentVariable),
            out var seconds) && seconds >= 0
                ? TimeSpan.FromSeconds(seconds)
                : options.StartupDelay;

    /// <summary>The environment wins, so a test or a staging build can redirect the feed.</summary>
    private string? ConfiguredFeedUrl()
    {
        var fromEnvironment = VidraRuntimeSettings.Get(VidraUpdateOptions.FeedUrlEnvironmentVariable);
        if (!string.IsNullOrWhiteSpace(fromEnvironment))
            return fromEnvironment;

        return string.IsNullOrWhiteSpace(options.FeedUrl) ? null : options.FeedUrl;
    }

    private IBundleSource? ResolveSource()
    {
        if (options.Source is not null)
            return options.Source;

        var feedUrl = ConfiguredFeedUrl();
        if (string.IsNullOrWhiteSpace(feedUrl))
            return null;

        try
        {
            // A local path is as legitimate a feed as a URL — a mounted share, or
            // a directory a test serves from.
            if (!feedUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
                && !feedUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                return new FileBundleSource(feedUrl);
            }

            return new HttpBundleSource(feedUrl, options.Headers);
        }
        catch (Exception ex)
        {
            Log($"'{feedUrl}' is not a usable feed ({ex.Message})");
            return null;
        }
    }

    /// <summary>
    /// Reads the config <c>vidra build</c> stamped from the app's
    /// <c>package.json</c>. Options set in code win, so this only fills gaps.
    /// </summary>
    private async Task LoadStampedConfigAsync()
    {
        if (_configLoaded)
            return;

        _configLoaded = true;

        try
        {
            if (!await FileSystem.AppPackageFileExistsAsync(VidraUpdateOptions.ConfigFileName).ConfigureAwait(false))
                return;

            await using var stream = await FileSystem
                .OpenAppPackageFileAsync(VidraUpdateOptions.ConfigFileName)
                .ConfigureAwait(false);

            using var reader = new StreamReader(stream);
            var json = await reader.ReadToEndAsync().ConfigureAwait(false);

            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;

            if (options.FeedUrl is null
                && root.TryGetProperty("feedUrl", out var feedUrl)
                && feedUrl.ValueKind == JsonValueKind.String)
            {
                options.FeedUrl = feedUrl.GetString();
            }

            if (options.Channel is null
                && root.TryGetProperty("channel", out var channel)
                && channel.ValueKind == JsonValueKind.String)
            {
                options.Channel = channel.GetString();
            }

            if (options.PublicKeys.Count == 0
                && root.TryGetProperty("publicKeys", out var keys)
                && keys.ValueKind == JsonValueKind.Array)
            {
                foreach (var key in keys.EnumerateArray())
                {
                    if (key.ValueKind == JsonValueKind.String && key.GetString() is { Length: > 0 } value)
                        options.PublicKeys.Add(value);
                }
            }

            if (root.TryGetProperty("enabled", out var enabled) && enabled.ValueKind == JsonValueKind.False)
                options.Enabled = false;
        }
        catch (Exception ex)
        {
            Log($"could not read {VidraUpdateOptions.ConfigFileName} ({ex.Message}); using the options set in code");
        }
    }

    /// <summary>
    /// The version of the bundle the app shipped with, used to order updates
    /// until something has been installed. <c>AppInfo</c> reads it from the app
    /// manifest, which <c>vidra build</c> stamps from the app's package.json.
    /// </summary>
    /// <summary>
    /// The contracts of the binary running right now. Safe to read here because
    /// <c>VidraContractWarmup</c> has already resolved the dispatcher — read any
    /// earlier and the fingerprint is a hash of a partial manifest and looks
    /// perfectly valid.
    /// </summary>
    private HostContracts RunningHost()
        => new(
            BridgeContractRegistry.Fingerprint(BridgeManifestScope.Core),
            BridgeContractRegistry.Fingerprint(BridgeManifestScope.App),
            EmbeddedVersion())
        {
            AccessFingerprint = services.GetRequiredService<IBridgeAccessPolicy>().Fingerprint,
        };

    private static string? EmbeddedVersion()
    {
        try
        {
            return AppInfo.Current.VersionString;
        }
        catch
        {
            return null;
        }
    }

    private static string Short(string? value)
        => value is null ? "the embedded bundle" : value.Length <= 8 ? value : value[..8];

    private static void Log(string message)
    {
        Console.WriteLine($"[vidra] update: {message}");
        Console.Out.Flush();
    }
}
