using System.Diagnostics;
using UINet.Bridge;
#if WINDOWS
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;
#endif
#if IOS || MACCATALYST
using UserNotifications;
#endif

namespace UINet.Modules.Notifications;

public record ShowArgs(string Title, string? Body);
public record ShowResult(bool Scheduled);

public record RequestPermissionResult(bool Granted);

[BridgeModule("notifications")]
public sealed class NotificationsModule : BridgeModuleBase
{
    [BridgeMethod("show")]
    public async Task<ShowResult> ShowAsync(ShowArgs args, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(args.Title))
            throw new InvalidOperationException("Notification title is required.");

#if WINDOWS
        return new ShowResult(ShowWindowsNotification(args));
#elif IOS || MACCATALYST
        return new ShowResult(await ShowAppleNotificationAsync(args, ct));
#else
        return new ShowResult(false);
#endif
    }

    [BridgeMethod("requestPermission")]
    public async Task<RequestPermissionResult> RequestPermissionAsync(CancellationToken ct)
    {
#if WINDOWS
        return new RequestPermissionResult(GetWindowsNotificationsEnabled());
#elif IOS || MACCATALYST
        return new RequestPermissionResult(await RequestApplePermissionAsync(ct));
#else
        return new RequestPermissionResult(false);
#endif
    }

#if WINDOWS
    private static readonly object WindowsRegistrationLock = new();
    private static bool _windowsRegistered;

    private static bool GetWindowsNotificationsEnabled()
    {
        EnsureWindowsRegistration();
        return AppNotificationManager.Default.Setting == AppNotificationSetting.Enabled;
    }

    private static bool ShowWindowsNotification(ShowArgs args)
    {
        EnsureWindowsRegistration();

        if (AppNotificationManager.Default.Setting != AppNotificationSetting.Enabled)
            return false;

        var builder = new AppNotificationBuilder()
            .AddText(args.Title);

        if (!string.IsNullOrWhiteSpace(args.Body))
            builder.AddText(args.Body);

        AppNotificationManager.Default.Show(builder.BuildNotification());
        return true;
    }

    private static void EnsureWindowsRegistration()
    {
        if (_windowsRegistered)
            return;

        lock (WindowsRegistrationLock)
        {
            if (_windowsRegistered)
                return;

            AppNotificationManager.Default.Register();
            _windowsRegistered = true;
        }
    }
#endif

#if IOS || MACCATALYST
    private readonly AppleNotificationCenterDelegate _appleDelegate = new();
    private bool _appleConfigured;

    private async Task<bool> ShowAppleNotificationAsync(ShowArgs args, CancellationToken ct)
    {
        var bundleId = Foundation.NSBundle.MainBundle.BundleIdentifier ?? "(null)";
        Log($"show: bundleId={bundleId}");

        if (!await RequestApplePermissionAsync(ct))
        {
            Log("show: permission not granted, aborting");
            return false;
        }

        var settings = await GetAppleNotificationSettingsAsync(ct);
        Log($"show: status={settings.AuthorizationStatus} alert={settings.AlertSetting} sound={settings.SoundSetting} center={settings.NotificationCenterSetting}");

        if (!CanPresentAppleNotifications(settings))
        {
            Log("show: alerts disabled in system settings, aborting");
            return false;
        }

        var content = new UNMutableNotificationContent
        {
            Title = args.Title,
            Body = args.Body ?? string.Empty,
            Sound = UNNotificationSound.Default
        };

        var identifier = Guid.NewGuid().ToString("N");
        var request = UNNotificationRequest.FromIdentifier(identifier, content, null);

        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        UNUserNotificationCenter.Current.AddNotificationRequest(request, error =>
        {
            if (error is not null)
            {
                Log($"show: add error {error.LocalizedDescription}");
                tcs.TrySetException(new InvalidOperationException(error.LocalizedDescription));
                return;
            }

            Log($"show: queued id={identifier} trigger=immediate");
            tcs.TrySetResult(true);
        });

        return await tcs.Task.WaitAsync(ct);
    }

    private async Task<bool> RequestApplePermissionAsync(CancellationToken ct)
    {
        await EnsureAppleConfiguredAsync();

        var settings = await GetAppleNotificationSettingsAsync(ct);
        Log($"request: initial status={settings.AuthorizationStatus} alert={settings.AlertSetting}");

        if (CanPresentAppleNotifications(settings))
            return true;

        if (settings.AuthorizationStatus == UNAuthorizationStatus.Denied)
        {
            Log("request: denied, not re-prompting");
            return false;
        }

        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        UNUserNotificationCenter.Current.RequestAuthorization(
            UNAuthorizationOptions.Alert | UNAuthorizationOptions.Badge | UNAuthorizationOptions.Sound,
            (granted, error) =>
            {
                if (error is not null)
                {
                    Log($"request: error {error.LocalizedDescription}");
                    tcs.TrySetException(new InvalidOperationException(error.LocalizedDescription));
                    return;
                }

                Log($"request: granted={granted}");
                tcs.TrySetResult(granted);
            }
        );

        var grantedResult = await tcs.Task.WaitAsync(ct);
        if (!grantedResult)
            return false;

        settings = await GetAppleNotificationSettingsAsync(ct);
        Log($"request: post-grant status={settings.AuthorizationStatus} alert={settings.AlertSetting}");
        return CanPresentAppleNotifications(settings);
    }

    private async Task EnsureAppleConfiguredAsync()
    {
        if (_appleConfigured)
            return;

        await MainThread.InvokeOnMainThreadAsync(() =>
        {
            if (_appleConfigured)
                return;

            UNUserNotificationCenter.Current.Delegate = _appleDelegate;
            _appleConfigured = true;
            Log("configure: delegate attached");
        });
    }

    private static async Task<UNNotificationSettings> GetAppleNotificationSettingsAsync(CancellationToken ct)
    {
        var tcs = new TaskCompletionSource<UNNotificationSettings>(TaskCreationOptions.RunContinuationsAsynchronously);
        UNUserNotificationCenter.Current.GetNotificationSettings(settings =>
        {
            tcs.TrySetResult(settings);
        });

        return await tcs.Task.WaitAsync(ct);
    }

    private static bool IsAppleAuthorizationGranted(UNAuthorizationStatus status)
    {
        return status == UNAuthorizationStatus.Authorized
            || status == UNAuthorizationStatus.Provisional
            || status == UNAuthorizationStatus.Ephemeral;
    }

    private static bool CanPresentAppleNotifications(UNNotificationSettings settings)
    {
        return IsAppleAuthorizationGranted(settings.AuthorizationStatus)
            && settings.AlertSetting == UNNotificationSetting.Enabled;
    }

    private sealed class AppleNotificationCenterDelegate : UNUserNotificationCenterDelegate
    {
        public override void WillPresentNotification(
            UNUserNotificationCenter center,
            UNNotification notification,
            Action<UNNotificationPresentationOptions> completionHandler)
        {
            Log($"delegate: willPresent id={notification.Request.Identifier}");
            completionHandler(
                UNNotificationPresentationOptions.Banner
                | UNNotificationPresentationOptions.List
                | UNNotificationPresentationOptions.Sound
            );
        }
    }

    private static void Log(string message)
    {
        var line = $"[UINet.Notifications] {message}";
        Debug.WriteLine(line);
        Console.WriteLine(line);
    }
#endif
}
