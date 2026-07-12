import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { VidraClient } from "../client.js";
import type {
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
  ReverseRequest,
  ReverseResponse,
} from "../types.js";
import type { Transport } from "../transport.js";

class MockTransport implements Transport {
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
  (window as any).__vidra_callback(response);
};

const dispatchEvent = (event: BridgeEvent): void => {
  (window as any).__vidra_onevent(event);
};

const dispatchReverse = (request: ReverseRequest): void => {
  (window as any).__vidra_invoke(request);
};

describe("VidraClient unsafe invoke", () => {
  let transport: MockTransport;
  let client: VidraClient;

  beforeEach(() => {
    transport = new MockTransport();
    client = new VidraClient({ transport });
  });

  it("resolves with success data", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: true, data: { text: "hi" } });

    const result = await client.unsafe.invoke<{ text: string }>("echo", "ping", { text: "hi" });
    expect(result).toEqual({ text: "hi" });
  });

  it("sends the request through the transport", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: true });
    await client.unsafe.invoke("echo", "ping", { n: 1 });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      contract: "echo",
      member: "ping",
      payload: { n: 1 },
    });
    expect(transport.sent[0].id).toMatch(/^req_/);
  });

  it("rejects with formatted error when native responds with error", async () => {
    transport.onSend = (req) =>
      deliver({
        id: req.id,
        success: false,
        error: { code: "NATIVE_CONTRACT_NOT_FOUND", message: "No native contract 'x'" },
      });

    await expect(client.unsafe.invoke("x", "y")).rejects.toThrow(
      "[NATIVE_CONTRACT_NOT_FOUND] No native contract 'x'",
    );
  });

  it("rejects with generic message if error body missing", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: false });

    await expect(client.unsafe.invoke("x", "y")).rejects.toThrow("Unknown native error");
  });

  it("rejects with timeout if no response arrives", async () => {
    vi.useFakeTimers();
    const clientWithTimeout = new VidraClient({ transport, timeout: 50 });
    const promise = clientWithTimeout.unsafe.invoke("slow", "op");

    vi.advanceTimersByTime(51);
    await expect(promise).rejects.toThrow(/Timeout after 50ms for slow\.op/);
    vi.useRealTimers();
  });

  it("ignores responses with an unknown id", async () => {
    const spy = vi.fn();
    transport.onSend = (req) => {
      deliver({ id: "not-the-right-id", success: true });
      setTimeout(() => deliver({ id: req.id, success: true, data: "ok" }), 0);
    };

    const result = await client.unsafe.invoke("echo", "ping").then((r) => {
      spy(r);
      return r;
    });

    expect(result).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("VidraClient events", () => {
  let transport: MockTransport;
  let client: VidraClient;

  beforeEach(() => {
    transport = new MockTransport();
    client = new VidraClient({ transport });
  });

  it("delivers events to subscribed handlers", () => {
    const handler = vi.fn();
    client.unsafe.on<{ x: number }>("test", "tick", handler);

    dispatchEvent({ contract: "test", member: "tick", payload: { x: 1 } });
    dispatchEvent({ contract: "test", member: "tick", payload: { x: 2 } });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, { x: 1 });
    expect(handler).toHaveBeenNthCalledWith(2, { x: 2 });
  });

  it("supports multiple handlers per event", () => {
    const a = vi.fn();
    const b = vi.fn();
    client.unsafe.on("test", "tick", a);
    client.unsafe.on("test", "tick", b);

    dispatchEvent({ contract: "test", member: "tick", payload: null });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("returns an unsubscribe function", () => {
    const handler = vi.fn();
    const off = client.unsafe.on("test", "tick", handler);
    off();

    dispatchEvent({ contract: "test", member: "tick", payload: null });
    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates exceptions in one handler from others", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();

    client.unsafe.on("test", "tick", bad);
    client.unsafe.on("test", "tick", good);

    dispatchEvent({ contract: "test", member: "tick", payload: null });

    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ignores events that no one is subscribed to", () => {
    expect(() =>
      dispatchEvent({ contract: "test", member: "unhandled", payload: null }),
    ).not.toThrow();
  });
});

describe("VidraClient reverse RPC", () => {
  let transport: MockTransport;
  let client: VidraClient;

  beforeEach(() => {
    transport = new MockTransport();
    client = new VidraClient({ transport });
  });

  it("responds with JS_HANDLER_NOT_FOUND when no handler is registered", async () => {
    dispatchReverse({ id: "rev_1", contract: "dialog", member: "confirm" });
    await Promise.resolve();

    expect(transport.sentReverse).toHaveLength(1);
    expect(transport.sentReverse[0]).toMatchObject({
      id: "rev_1",
      success: false,
      error: { code: "JS_HANDLER_NOT_FOUND" },
    });
  });

  it("dispatches matching handlers and returns their result", async () => {
    client.unsafe.handle<{ message: string }, boolean>(
      "dialog",
      "confirm",
      async () => true,
    );
    dispatchReverse({
      id: "rev_2",
      contract: "dialog",
      member: "confirm",
      payload: { message: "?" },
    });

    await vi.waitFor(() => expect(transport.sentReverse).toHaveLength(1));
    expect(transport.sentReverse[0]).toEqual({ id: "rev_2", success: true, data: true });
  });

  it("wraps handler exceptions as JS_HANDLER_ERROR", async () => {
    client.unsafe.handle("test", "boom", () => {
      throw new Error("something broke");
    });
    dispatchReverse({ id: "rev_3", contract: "test", member: "boom" });

    await vi.waitFor(() => expect(transport.sentReverse).toHaveLength(1));
    expect(transport.sentReverse[0]).toMatchObject({
      id: "rev_3",
      success: false,
      error: { code: "JS_HANDLER_ERROR", message: "something broke" },
    });
  });

  it("unsubscribing a handler restores the JS_HANDLER_NOT_FOUND response", async () => {
    const unsubscribe = client.unsafe.handle("dialog", "confirm", () => true);
    unsubscribe();

    dispatchReverse({ id: "rev_4", contract: "dialog", member: "confirm" });
    await Promise.resolve();

    expect(transport.sentReverse[0]).toMatchObject({
      success: false,
      error: { code: "JS_HANDLER_NOT_FOUND" },
    });
  });

  it("rejects duplicate handler registrations", () => {
    client.unsafe.handle("dialog", "confirm", () => true);

    expect(() =>
      client.unsafe.handle("dialog", "confirm", () => false),
    ).toThrow("already registered");
  });
});

describe("VidraClient.capabilities", () => {
  it("invokes the reserved __bridge.capabilities method", async () => {
    const transport = new MockTransport();
    transport.onSend = (req) =>
      deliver({
        id: req.id,
        success: true,
        data: {
          protocolVersion: 2,
          nativeContracts: { echo: { methods: ["ping"], events: [] } },
        },
      });
    const client = new VidraClient({ transport });

    const caps = await client.capabilities();
    expect(caps.nativeContracts.echo.methods).toEqual(["ping"]);
    expect(transport.sent[0]).toMatchObject({
      contract: "__bridge",
      member: "capabilities",
    });
  });
});

describe("VidraClient transport selection", () => {
  afterEach(() => {
    delete (window as any).__vidra_native;
  });

  it("uses the explicit transport when provided", async () => {
    const transport = new MockTransport();
    transport.onSend = (req) => deliver({ id: req.id, success: true });
    const client = new VidraClient({ transport });

    await client.unsafe.invoke("x", "y");
    expect(transport.sent).toHaveLength(1);
  });
});

describe("VidraClient protocol negotiation", () => {
  const emptyFingerprint =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  it("accepts matching protocol and manifest fingerprints", () => {
    new VidraClient({ transport: new MockTransport() });

    expect(() =>
      (window as any).__vidra_initialize({
        protocolVersion: 2,
        coreFingerprint: emptyFingerprint,
        appFingerprint: emptyFingerprint,
      }),
    ).not.toThrow();
  });

  it("fails visibly when protocol versions differ", () => {
    new VidraClient({ transport: new MockTransport() });

    expect(() =>
      (window as any).__vidra_initialize({
        protocolVersion: 1,
        coreFingerprint: emptyFingerprint,
        appFingerprint: emptyFingerprint,
      }),
    ).toThrow("Bridge contract mismatch");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "protocol host=1 sdk=2",
    );
  });

  it("compares generated core and app fingerprints", () => {
    const client = new VidraClient({ transport: new MockTransport() });
    client.registerGeneratedManifest("core", "core-hash");
    client.registerGeneratedManifest("app", "app-hash");

    expect(() =>
      (window as any).__vidra_initialize({
        protocolVersion: 2,
        coreFingerprint: "core-hash",
        appFingerprint: "app-hash",
      }),
    ).not.toThrow();
  });
});
