using Vidra.Bridge;

namespace Vidra.Modules.Windowing;

public enum WindowState
{
    Restored,
    Maximized,
    Minimized,
    Fullscreen
}

public record WindowInfo(string Title, double Width, double Height, WindowState State);

public record WindowSupport(
    string Platform,
    bool GetCurrent,
    bool Configure,
    bool SetTitle,
    bool SetSize,
    bool Center,
    bool Maximize,
    bool Minimize,
    bool Restore,
    bool SetFullscreen
);

public record ConfigureWindowArgs(string? Title, double? Width, double? Height);

public record SetTitleArgs(string Title);

public record SetSizeArgs(double Width, double Height);

public record SetFullscreenArgs(bool Enabled);

[BridgeEventContract("appWindow")]
public interface IAppWindowEvents
{
    [BridgeEvent("resized")]
    void Resized(WindowInfo payload);

    [BridgeEvent("stateChanged")]
    void StateChanged(WindowInfo payload);
}

/// <summary>
/// Argument validation for window dimensions. Lives in its own file so the
/// test suite can link it into a non-MAUI test project.
/// </summary>
public static class DimensionValidation
{
    public static void ValidateOptionalDimension(double? value, string name)
    {
        if (!value.HasValue)
            return;

        ValidateDimension(value.Value, name);
    }

    public static void ValidateDimension(double value, string name)
    {
        if (double.IsNaN(value) || double.IsInfinity(value) || value <= 0)
            throw new InvalidOperationException($"{name} must be a positive number.");
    }
}
