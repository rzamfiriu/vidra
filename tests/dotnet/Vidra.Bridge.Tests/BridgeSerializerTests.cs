using System.Text.Json;
using Vidra.Bridge;

namespace Vidra.Bridge.Tests;

public sealed class BridgeSerializerTests
{
    public record Sample(string FirstName, int? AgeYears);

    [Fact]
    public void Serialize_Uses_CamelCase_Property_Names()
    {
        var json = BridgeSerializer.Serialize(new Sample("Ada", 36));
        json.Should().Contain("\"firstName\":\"Ada\"");
        json.Should().Contain("\"ageYears\":36");
    }

    [Fact]
    public void Serialize_Omits_Null_Values()
    {
        var json = BridgeSerializer.Serialize(new Sample("Ada", null));
        json.Should().NotContain("ageYears");
    }

    [Fact]
    public void Deserialize_Accepts_CamelCase()
    {
        var json = "{\"firstName\":\"Ada\",\"ageYears\":40}";
        var sample = BridgeSerializer.Deserialize<Sample>(json);
        sample!.FirstName.Should().Be("Ada");
        sample.AgeYears.Should().Be(40);
    }

    [Fact]
    public void Roundtrip_Of_BridgeResponse_Preserves_Shape()
    {
        var response = new BridgeResponse
        {
            Id = "req_1",
            Success = true,
            Data = new { text = "hi" },
        };

        var json = BridgeSerializer.Serialize(response);
        var parsed = JsonSerializer.Deserialize<JsonElement>(json);
        parsed.GetProperty("id").GetString().Should().Be("req_1");
        parsed.GetProperty("success").GetBoolean().Should().BeTrue();
        parsed.GetProperty("data").GetProperty("text").GetString().Should().Be("hi");
        parsed.TryGetProperty("error", out _).Should().BeFalse("null error is omitted");
    }
}

public sealed class JsonPayloadTests
{
    public record Args(string Title, int? Count);

    [Fact]
    public void Deserialize_Typed_Returns_Model()
    {
        var element = JsonSerializer.SerializeToElement(new { title = "hello", count = 3 }, BridgeSerializer.Default);
        var payload = new JsonPayload(element);

        var args = payload.Deserialize<Args>();
        args!.Title.Should().Be("hello");
        args.Count.Should().Be(3);
    }

    [Fact]
    public void Deserialize_With_Type_Parameter_Returns_Model()
    {
        var element = JsonSerializer.SerializeToElement(new { title = "x" }, BridgeSerializer.Default);
        var payload = new JsonPayload(element);

        var args = payload.Deserialize(typeof(Args));
        args.Should().BeOfType<Args>();
        ((Args)args!).Title.Should().Be("x");
    }

    [Fact]
    public void Raw_Returns_Original_Element()
    {
        var element = JsonSerializer.SerializeToElement(new { a = 1 }, BridgeSerializer.Default);
        var payload = new JsonPayload(element);
        payload.Raw.GetProperty("a").GetInt32().Should().Be(1);
    }
}
