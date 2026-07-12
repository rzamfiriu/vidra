using Vidra.Bridge;

namespace Vidra.CodeGen.AppFixture;

public record IncrementArgs(int Amount);

[JsContract("counter")]
public interface ICounterJs
{
    [JsMethod("increment")]
    Task<int> IncrementAsync(IncrementArgs payload);
}
