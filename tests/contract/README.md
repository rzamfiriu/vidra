# Bridge contract fixtures

Shared JSON fixtures that both the C# dispatcher (`UINet.Bridge`) and the
TypeScript SDK (`@uinet/sdk`) validate against. The goal is to keep the
wire format stable across languages.

Each file represents one canonical request or response on the bridge:

- `invoke.*` — JS to native invoke roundtrips.
- `event.*` — events the native side pushes to JS.
- `reverse.*` — reverse RPC from native into a JS handler.
- `capabilities.*` — response shape for `__bridge.capabilities`.

Both test suites import these files from this directory. Changes here are
contract changes and must be accompanied by matching updates on both sides.
