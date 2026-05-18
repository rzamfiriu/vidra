using UINet.Modules.Windowing;

namespace UINet.Modules.Windowing.Tests;

public sealed class DimensionValidationTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void ValidateDimension_Rejects_Non_Positive_Values(double value)
    {
        Action act = () => DimensionValidation.ValidateDimension(value, "width");
        act.Should().Throw<InvalidOperationException>()
            .WithMessage("*width*positive*");
    }

    [Fact]
    public void ValidateDimension_Accepts_Positive_Values()
    {
        Action act = () => DimensionValidation.ValidateDimension(0.1, "width");
        act.Should().NotThrow();
    }

    [Fact]
    public void ValidateOptionalDimension_Ignores_Null()
    {
        Action act = () => DimensionValidation.ValidateOptionalDimension(null, "width");
        act.Should().NotThrow();
    }

    [Fact]
    public void ValidateOptionalDimension_Rejects_Non_Positive()
    {
        Action act = () => DimensionValidation.ValidateOptionalDimension(-5, "width");
        act.Should().Throw<InvalidOperationException>();
    }
}
