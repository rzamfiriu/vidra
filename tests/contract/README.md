# Bridge contract fixtures

Shared JSON fixtures that both the C# dispatcher (`Vidra.Bridge`) and the
TypeScript SDK (`@vidra-dev/sdk`) validate against. The goal is to keep the
wire format stable across languages.

Each file represents one canonical request or response on the bridge:

- `invoke.*` — JS→C# native-contract roundtrips.
- `event.*` — C#→JS event-contract pushes.
- `reverse.*` — internal wire fixtures for C#→JS JS-contract calls.
- `capabilities.*` — response shape for `__bridge.capabilities`.

Both test suites import these files from this directory. Changes here are
contract changes and must be accompanied by matching updates on both sides.
