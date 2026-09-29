namespace Vidra.Modules.Essentials;

/// <summary>
/// Per-platform capability matrix for the Essentials modules, mirroring the
/// <c>appWindow.getSupport</c> precedent so the JS layer can feature-detect
/// before calling a method that might be unavailable on the current platform.
/// </summary>
public record EssentialsSupport(
    string Platform,
    bool SecureStorage,
    bool Preferences,
    bool Device,
    bool Share,
    bool Browser,
    bool Launcher,
    bool Email,
    bool FilePicker,
    bool TextToSpeech,
    bool Connectivity,
    bool Battery
);

/// <summary>
/// Pure construction of the support matrix, kept free of MAUI types so it can
/// be unit-tested. Runtime probes supply capabilities whose availability
/// depends on installed applications or services.
/// </summary>
public static class EssentialsSupportFactory
{
    public static EssentialsSupport Create(
        string platform,
        bool emailComposeSupported,
        bool textToSpeechSupported = true)
        => new(
            Platform: platform,
            SecureStorage: true,
            Preferences: true,
            Device: true,
            Share: true,
            Browser: true,
            Launcher: true,
            Email: emailComposeSupported,
            FilePicker: true,
            TextToSpeech: textToSpeechSupported,
            Connectivity: true,
            Battery: true);
}
