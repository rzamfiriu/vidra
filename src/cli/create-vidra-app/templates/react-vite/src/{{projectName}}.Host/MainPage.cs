using Vidra.Hosting;

namespace {{projectName}};

public class MainPage : VidraPage
{
    public MainPage()
    {
        StartCounterTimer();
    }

    private async void StartCounterTimer()
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(10));
        while (await timer.WaitForNextTickAsync())
        {
            await OnTickAsync();
        }
    }

    private async Task OnTickAsync()
    {
        try
        {
            var count = await Bridge.Js().Counter.IncrementAsync();
            System.Diagnostics.Debug.WriteLine($"[MainPage] Counter is now {count}");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[MainPage] Counter increment failed: {ex.Message}");
        }
    }
}
