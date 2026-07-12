using Vidra.Bridge;

namespace {{projectName}};

[JsContract("counter")]
public interface ICounterJs
{
    [JsMethod("increment")]
    Task<int> IncrementAsync();
}
