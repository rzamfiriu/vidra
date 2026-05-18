import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { UINetClient } from "../client.js";
import type {
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
  ReverseRequest,
  ReverseResponse,
} from "../types.js";
import type { Transport } from "../transport.js";

const FIXTURE_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../tests/contract/fixtures",
);

const readFixture = (name: string): any =>
  JSON.parse(readFileSync(resolve(FIXTURE_DIR, name), "utf8"));

class RecordingTransport implements Transport {
  public sent: BridgeRequest[] = [];
  public sentReverse: ReverseResponse[] = [];
  public onSend?: (req: BridgeRequest) => void;

  send = (request: BridgeRequest): void => {
    this.sent.push(request);
    this.onSend?.(request);
  };

  sendReverse = (response: ReverseResponse): void => {
    this.sentReverse.push(response);
  };
}

const deliver = (response: BridgeResponse): void => {
  (window as any).__uinet_callback(response);
};

describe("Bridge contract fixtures (SDK side)", () => {
  let transport: RecordingTransport;
  let client: UINetClient;

  beforeEach(() => {
    transport = new RecordingTransport();
    client = new UINetClient({ transport });
  });

  it("consumes invoke.success.response.json and returns data", async () => {
    const expected = readFixture("invoke.success.response.json");
    transport.onSend = (req) => deliver({ ...expected, id: req.id });

    const result = await client.invoke("echo", "ping", { text: "hello" });
    expect(result).toEqual(expected.data);
  });

  it("consumes invoke.module_not_found.response.json and rejects", async () => {
    const expected = readFixture("invoke.module_not_found.response.json");
    transport.onSend = (req) => deliver({ ...expected, id: req.id });

    await expect(client.invoke("does-not-exist", "noop")).rejects.toThrow(
      `[${expected.error.code}] ${expected.error.message}`,
    );
  });

  it("consumes invoke.module_error.response.json and rejects", async () => {
    const expected = readFixture("invoke.module_error.response.json");
    transport.onSend = (req) => deliver({ ...expected, id: req.id });

    await expect(client.invoke("echo", "fail")).rejects.toThrow(
      `[${expected.error.code}] ${expected.error.message}`,
    );
  });

  it("consumes capabilities.response.json", async () => {
    const expected = readFixture("capabilities.response.json");
    transport.onSend = (req) => deliver({ ...expected, id: req.id });

    const caps = await client.capabilities();
    expect(caps).toEqual(expected.data);
  });

  it("emits events matching event.app_resume.json shape", () => {
    const received: unknown[] = [];
    client.on("app.resume", (d) => received.push(d));

    const event = readFixture("event.app_resume.json") as BridgeEvent;
    (window as any).__uinet_onevent(event);

    expect(received).toEqual([event.data]);
  });

  it("reverse.success.request.json is handled and produces a success response", async () => {
    client.handle<{ message: string }, boolean>("confirm", async () => true);

    const req = readFixture("reverse.success.request.json") as ReverseRequest;
    (window as any).__uinet_invoke(req);

    // drain microtasks
    await new Promise((resolve) => setTimeout(resolve, 0));

    const expected = readFixture("reverse.success.response.json");
    expect(transport.sentReverse[0]).toEqual(expected);
  });

  it("unregistered handlers produce reverse.handler_not_found.response.json", async () => {
    const expected = readFixture("reverse.handler_not_found.response.json");

    const request: ReverseRequest = { id: expected.id, handler: "confirm" };
    (window as any).__uinet_invoke(request);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.sentReverse[0]).toEqual(expected);
  });

  it("throwing handlers produce reverse.handler_error.response.json shape", async () => {
    client.handle("boom", () => {
      throw new Error("boom");
    });
    const expected = readFixture("reverse.handler_error.response.json");

    (window as any).__uinet_invoke({ id: expected.id, handler: "boom" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transport.sentReverse[0].id).toBe(expected.id);
    expect(transport.sentReverse[0].success).toBe(false);
    expect(transport.sentReverse[0].error?.code).toBe(expected.error.code);
    expect(transport.sentReverse[0].error?.message).toBe(expected.error.message);
  });
});
