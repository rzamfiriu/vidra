using System.Text.Json;
using Vidra.Bridge;

namespace Vidra.Modules.Essentials.Tests;

public sealed class ConnectivitySerializationTests
{
    [Fact]
    public void ConnectivityStatus_Serializes_Enums_As_CamelCase_Strings_And_Arrays()
    {
        var status = new ConnectivityStatus(
            NetworkAccess.ConstrainedInternet,
            new[] { ConnectionProfile.Wifi, ConnectionProfile.Ethernet });

        var element = JsonSerializer.Deserialize<JsonElement>(BridgeSerializer.Serialize(status));

        element.GetProperty("access").GetString().Should().Be("constrainedInternet");
        element.GetProperty("profiles").EnumerateArray().Select(e => e.GetString())
            .Should().Equal("wifi", "ethernet");
    }

    [Fact]
    public void ConnectivityStatus_Roundtrips_Through_Serializer()
    {
        var status = new ConnectivityStatus(NetworkAccess.Internet, new[] { ConnectionProfile.Ethernet });

        var back = BridgeSerializer.Deserialize<ConnectivityStatus>(BridgeSerializer.Serialize(status));

        back!.Access.Should().Be(NetworkAccess.Internet);
        back.Profiles.Should().Equal(ConnectionProfile.Ethernet);
    }

    [Fact]
    public void Generated_Event_Token_Serializes_Without_Runtime_Reflection()
    {
        var status = new ConnectivityStatus(
            NetworkAccess.Internet,
            new[] { ConnectionProfile.Wifi });

        var payload = ConnectivityEvents.Changed.SerializePayload(status);

        payload.GetProperty("access").GetString().Should().Be("internet");
        payload.GetProperty("profiles")[0].GetString().Should().Be("wifi");
    }
}

public sealed class BatterySerializationTests
{
    [Fact]
    public void BatteryStatus_Serializes_Enums_As_CamelCase_Strings()
    {
        var status = new BatteryStatus(0.42, BatteryState.NotCharging, BatteryPowerSource.Ac, EnergySaverStatus.On);

        var element = JsonSerializer.Deserialize<JsonElement>(BridgeSerializer.Serialize(status));

        element.GetProperty("chargeLevel").GetDouble().Should().Be(0.42);
        element.GetProperty("state").GetString().Should().Be("notCharging");
        element.GetProperty("powerSource").GetString().Should().Be("ac");
        element.GetProperty("energySaver").GetString().Should().Be("on");
    }
}

public sealed class EssentialsSupportFactoryTests
{
    [Fact]
    public void Create_Passes_Platform_Through_And_Defaults_To_Supported()
    {
        var support = EssentialsSupportFactory.Create("MacCatalyst", emailComposeSupported: true);

        support.Platform.Should().Be("MacCatalyst");
        support.SecureStorage.Should().BeTrue();
        support.Connectivity.Should().BeTrue();
        support.Battery.Should().BeTrue();
        support.Email.Should().BeTrue();
    }

    [Fact]
    public void Create_Gates_Email_On_Compose_Support()
    {
        var support = EssentialsSupportFactory.Create("WinUI", emailComposeSupported: false);

        support.Email.Should().BeFalse();
        support.FilePicker.Should().BeTrue();
    }
}

public sealed class ConnectivityDispatcherTests
{
    [BridgeModule("connectivity")]
    private sealed class FakeConnectivityModule : BridgeModuleBase
    {
        private readonly ConnectivityStatus _status;

        public FakeConnectivityModule(ConnectivityStatus status) => _status = status;

        [BridgeMethod("getStatus")]
        public Task<ConnectivityStatus> GetStatusAsync(CancellationToken ct)
            => Task.FromResult(_status);
    }

    [Fact]
    public async Task GetStatus_Roundtrips_Through_Dispatcher_As_Enum_Strings()
    {
        var dispatcher = new BridgeDispatcher();
        dispatcher.Register(new FakeConnectivityModule(
            new ConnectivityStatus(NetworkAccess.Internet, new[] { ConnectionProfile.Wifi })));

        var request = BridgeSerializer.Serialize(new BridgeRequest
        {
            Id = "c1",
            Contract = "connectivity",
            Member = "getStatus",
        });

        var response = JsonSerializer.Deserialize<JsonElement>(await dispatcher.DispatchAsync(request));

        response.GetProperty("success").GetBoolean().Should().BeTrue();
        var data = response.GetProperty("data");
        data.GetProperty("access").GetString().Should().Be("internet");
        data.GetProperty("profiles").EnumerateArray().Select(e => e.GetString()).Should().Equal("wifi");
    }
}
