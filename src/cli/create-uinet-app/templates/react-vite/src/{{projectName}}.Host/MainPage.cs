using UINet.Hosting;

namespace {{projectName}};

public class MainPage : UINetPage
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
            try
            {
                var count = await Bridge.CallJsAsync<int>("counter.increment");
                System.Diagnostics.Debug.WriteLine($"[MainPage] Counter is now {count}");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[MainPage] Counter increment failed: {ex.Message}");
            }
        }
    }
}
