import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createBridge, type VidraBridge } from "../client.js";
import type {
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
  ReverseRequest,
  ReverseResponse,
} from "../types.js";
import type { Transport } from "../transport.js";
import type { ConnectivityStatus } from "../generated/connectivity.js";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../tests/contract/fixtures",
);

const readFixture = (name: string): any =>
  JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), "utf8"));

interface RecordingTransport extends Transport {
  sent: BridgeRequest[];
  sentReverse: ReverseResponse[];
  onSend?: (request: BridgeRequest) => void;
}

const createRecordingTransport = (): RecordingTransport => {
  const transport: RecordingTransport = {
    sent: [],
    sentReverse: [],
    send: (request) => {
      transport.sent.push(request);
      transport.onSend?.(request);
    },
    sendReverse: (response) => {
      transport.sentReverse.push(response);
    },
  };
  return transport;
};

describe("Bridge contract fixtures (SDK side)", () => {
  let transport: RecordingTransport;
  let bridge: VidraBridge;
  let deliver: (response: BridgeResponse) => void;

  beforeEach(() => {
    transport = createRecordingTransport();
    bridge = createBridge({ transport });
    deliver = bridge.host.deliverResponse;
  });

  it("consumes invoke.success.response.json and returns data", async () => {
    const expected = readFixture("invoke.success.response.json");
    transport.onSend = (req) => deliver({ ...expected, id: req.id });

    const result = await bridge.unsafe.invoke("echo", "ping", { text: "hello" });
    expect(result).toEqual(expected.data);
  });

  it("consumes invoke.module_not_found.response.json and rejects", async () => {
    const expected = readFixture("invoke.module_not_found.response.json");
    transport.onSend = (req) => deliver({ ...expected, id: req.id });

    await expect(bridge.unsafe.invoke("does-not-exist", "noop")).rejects.toThrow(
      `[${expected.error.code}] ${expected.error.message}`,
    );
  });

  it("consumes invoke.module_error.response.json and rejects", async () => {
    const expected = readFixture("invoke.module_error.response.json");
    transport.onSend = (req) => deliver({ ...expected, id: req.id });

    await expect(bridge.unsafe.invoke("echo", "fail")).rejects.toThrow(
      `[${expected.error.code}] ${expected.error.message}`,
    );
  });

  it("consumes capabilities.response.json", async () => {
    const expected = readFixture("capabilities.response.json");
    transport.onSend = (req) => deliver({ ...expected, id: req.id });

    const caps = await bridge.capabilities();
    expect(caps).toEqual(expected.data);
  });

  it("emits events matching event.runtime_hot_reloaded.json shape", () => {
    const received: unknown[] = [];
    bridge.unsafe.on("runtime", "hotReloaded", (data) => received.push(data));

    const event = readFixture("event.runtime_hot_reloaded.json") as BridgeEvent;
    bridge.host.dispatchEvent(event);

    expect(received).toEqual([event.payload]);
  });

  it("delivers connectivity.changed enum event matching the generated type", () => {
    const received: ConnectivityStatus[] = [];
    bridge.unsafe.on<ConnectivityStatus>(
      "connectivity",
      "changed",
      (data) => received.push(data),
    );

    const event = readFixture("event.connectivity_changed.json") as BridgeEvent;
    bridge.host.dispatchEvent(event);

    // The typed literal makes tsc verify the fixture's enum strings are valid
    // members of the generated string-union types (guards enum wire drift).
    const expected: ConnectivityStatus = {
      access: "internet",
      profiles: ["wifi", "ethernet"],
    };
    expect(received).toEqual([expected]);
  });

  it("reverse.success.request.json is handled and produces a success response", async () => {
    bridge.unsafe.handle<{ message: string }, boolean>(
      "dialog",
      "confirm",
      async () => true,
    );

    const req = readFixture("reverse.success.request.json") as ReverseRequest;
    await bridge.host.invokeHandler(req);

    const expected = readFixture("reverse.success.response.json");
    expect(transport.sentReverse[0]).toEqual(expected);
  });

  it("unregistered handlers produce reverse.handler_not_found.response.json", async () => {
    const expected = readFixture("reverse.handler_not_found.response.json");

    await bridge.host.invokeHandler({
      id: expected.id,
      contract: "dialog",
      member: "confirm",
    });

    expect(transport.sentReverse[0]).toEqual(expected);
  });

  it("throwing handlers produce reverse.handler_error.response.json shape", async () => {
    bridge.unsafe.handle("test", "boom", () => {
      throw new Error("boom");
    });
    const expected = readFixture("reverse.handler_error.response.json");

    await bridge.host.invokeHandler({
      id: expected.id,
      contract: "test",
      member: "boom",
    });

    expect(transport.sentReverse[0].id).toBe(expected.id);
    expect(transport.sentReverse[0].success).toBe(false);
    expect(transport.sentReverse[0].error?.code).toBe(expected.error.code);
    expect(transport.sentReverse[0].error?.message).toBe(expected.error.message);
  });
});
