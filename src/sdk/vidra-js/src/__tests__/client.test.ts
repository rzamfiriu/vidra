import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createBridge,
  createExpectations,
  installWindowCallbacks,
  type VidraBridge,
} from "../client.js";
import type {
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
  ReverseRequest,
  ReverseResponse,
} from "../types.js";
import type { Transport } from "../transport.js";

interface MockTransport extends Transport {
  sent: BridgeRequest[];
  sentReverse: ReverseResponse[];
  onSend?: (request: BridgeRequest) => void;
}

const createMockTransport = (): MockTransport => {
  const transport: MockTransport = {
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

const deliver = (response: BridgeResponse): void => {
  (window as any).__vidra_callback(response);
};

const dispatchEvent = (event: BridgeEvent): void => {
  (window as any).__vidra_onevent(event);
};

const dispatchReverse = (request: ReverseRequest): void => {
  (window as any).__vidra_invoke(request);
};

const EMPTY_FINGERPRINT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("bridge unsafe invoke", () => {
  let transport: MockTransport;
  let bridge: VidraBridge;
  let uninstall: () => void;

  beforeEach(() => {
    transport = createMockTransport();
    bridge = createBridge({ transport });
    uninstall = installWindowCallbacks(bridge);
  });

  afterEach(() => uninstall());

  it("resolves with success data", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: true, data: { text: "hi" } });

    const result = await bridge.unsafe.invoke<{ text: string }>("echo", "ping", { text: "hi" });
    expect(result).toEqual({ text: "hi" });
  });

  it("sends the request through the transport", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: true });
    await bridge.unsafe.invoke("echo", "ping", { n: 1 });

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

    await expect(bridge.unsafe.invoke("x", "y")).rejects.toThrow(
      "[NATIVE_CONTRACT_NOT_FOUND] No native contract 'x'",
    );
  });

  it("rejects with generic message if error body missing", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: false });

    await expect(bridge.unsafe.invoke("x", "y")).rejects.toThrow("Unknown native error");
  });

  it("rejects with timeout if no response arrives", async () => {
    vi.useFakeTimers();
    const bridgeWithTimeout = createBridge({ transport, timeout: 50 });
    const promise = bridgeWithTimeout.unsafe.invoke("slow", "op");

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

    const result = await bridge.unsafe.invoke("echo", "ping").then((r) => {
      spy(r);
      return r;
    });

    expect(result).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("bridge events", () => {
  let bridge: VidraBridge;
  let uninstall: () => void;

  beforeEach(() => {
    bridge = createBridge({ transport: createMockTransport() });
    uninstall = installWindowCallbacks(bridge);
  });

  afterEach(() => uninstall());

  it("delivers events to subscribed handlers", () => {
    const handler = vi.fn();
    bridge.unsafe.on<{ x: number }>("test", "tick", handler);

    dispatchEvent({ contract: "test", member: "tick", payload: { x: 1 } });
    dispatchEvent({ contract: "test", member: "tick", payload: { x: 2 } });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, { x: 1 });
    expect(handler).toHaveBeenNthCalledWith(2, { x: 2 });
  });

  it("supports multiple handlers per event", () => {
    const a = vi.fn();
    const b = vi.fn();
    bridge.unsafe.on("test", "tick", a);
    bridge.unsafe.on("test", "tick", b);

    dispatchEvent({ contract: "test", member: "tick", payload: null });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("returns an unsubscribe function", () => {
    const handler = vi.fn();
    const off = bridge.unsafe.on("test", "tick", handler);
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

    bridge.unsafe.on("test", "tick", bad);
    bridge.unsafe.on("test", "tick", good);

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

describe("bridge reverse RPC", () => {
  let transport: MockTransport;
  let bridge: VidraBridge;
  let uninstall: () => void;

  beforeEach(() => {
    transport = createMockTransport();
    bridge = createBridge({ transport });
    uninstall = installWindowCallbacks(bridge);
  });

  afterEach(() => uninstall());

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
    bridge.unsafe.handle<{ message: string }, boolean>(
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
    bridge.unsafe.handle("test", "boom", () => {
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
    const unsubscribe = bridge.unsafe.handle("dialog", "confirm", () => true);
    unsubscribe();

    dispatchReverse({ id: "rev_4", contract: "dialog", member: "confirm" });
    await Promise.resolve();

    expect(transport.sentReverse[0]).toMatchObject({
      success: false,
      error: { code: "JS_HANDLER_NOT_FOUND" },
    });
  });

  it("rejects duplicate handler registrations", () => {
    bridge.unsafe.handle("dialog", "confirm", () => true);

    expect(() =>
      bridge.unsafe.handle("dialog", "confirm", () => false),
    ).toThrow("already registered");
  });
});

describe("bridge.capabilities", () => {
  it("invokes the reserved __bridge.capabilities method", async () => {
    const transport = createMockTransport();
    const bridge = createBridge({ transport });
    transport.onSend = (req) =>
      bridge.host.deliverResponse({
        id: req.id,
        success: true,
        data: {
          protocolVersion: 2,
          nativeContracts: { echo: { methods: ["ping"], events: [] } },
        },
      });

    const caps = await bridge.capabilities();
    expect(caps.nativeContracts.echo.methods).toEqual(["ping"]);
    expect(transport.sent[0]).toMatchObject({
      contract: "__bridge",
      member: "capabilities",
    });
  });
});

describe("bridge transport selection", () => {
  afterEach(() => {
    delete (window as any).__vidra_native;
  });

  it("uses the explicit transport when provided", async () => {
    const transport = createMockTransport();
    const bridge = createBridge({ transport });
    transport.onSend = (req) => bridge.host.deliverResponse({ id: req.id, success: true });

    await bridge.unsafe.invoke("x", "y");
    expect(transport.sent).toHaveLength(1);
  });

  it("falls back to a browser stub that delivers to this bridge, not to window", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bridge = createBridge();
    const stray = vi.fn();
    (window as any).__vidra_callback = stray;

    await expect(bridge.unsafe.invoke("fs", "readText")).rejects.toThrow("[BROWSER_ONLY]");

    expect(stray).not.toHaveBeenCalled();
    delete (window as any).__vidra_callback;
    warnSpy.mockRestore();
  });
});

describe("installWindowCallbacks", () => {
  afterEach(() => {
    for (const name of [
      "__vidra_callback",
      "__vidra_onevent",
      "__vidra_invoke",
      "__vidra_initialize",
    ]) {
      delete (window as any)[name];
    }
  });

  it("installs the four host entry points", () => {
    const bridge = createBridge({ transport: createMockTransport() });
    const uninstall = installWindowCallbacks(bridge);

    expect((window as any).__vidra_callback).toBe(bridge.host.deliverResponse);
    expect((window as any).__vidra_onevent).toBe(bridge.host.dispatchEvent);
    expect((window as any).__vidra_invoke).toBe(bridge.host.invokeHandler);
    expect((window as any).__vidra_initialize).toBe(bridge.host.initialize);

    uninstall();
    expect((window as any).__vidra_callback).toBeUndefined();
    expect((window as any).__vidra_initialize).toBeUndefined();
  });

  it("uninstalling leaves callbacks installed later by another bridge in place", () => {
    const first = createBridge({ transport: createMockTransport() });
    const second = createBridge({ transport: createMockTransport() });
    const uninstallFirst = installWindowCallbacks(first);
    const uninstallSecond = installWindowCallbacks(second);

    uninstallFirst();

    expect((window as any).__vidra_callback).toBe(second.host.deliverResponse);
    uninstallSecond();
    expect((window as any).__vidra_callback).toBeUndefined();
  });
});

describe("expectations", () => {
  it("records a declared fingerprint per scope", () => {
    const expectations = createExpectations();
    expectations.declare("core", "core-hash");

    expect(expectations.get("core")).toBe("core-hash");
    expect(expectations.get("app")).toBeUndefined();
  });

  it("accepts re-declaring the same value", () => {
    const expectations = createExpectations();
    expectations.declare("app", "app-hash");

    expect(() => expectations.declare("app", "app-hash")).not.toThrow();
  });

  it("rejects a conflicting value for an already-declared scope", () => {
    const expectations = createExpectations();
    expectations.declare("app", "app-hash");

    expect(() => expectations.declare("app", "other-hash")).toThrow(
      /Conflicting app fingerprint declarations/,
    );
  });
});

describe("bridge protocol negotiation", () => {
  const handshake = (overrides: Partial<Parameters<VidraBridge["host"]["initialize"]>[0]>) => ({
    protocolVersion: 2,
    coreFingerprint: EMPTY_FINGERPRINT,
    appFingerprint: EMPTY_FINGERPRINT,
    accessFingerprint: "access",
    ...overrides,
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("accepts matching protocol and empty manifest fingerprints when nothing is declared", () => {
    const bridge = createBridge({ transport: createMockTransport() });

    expect(() => bridge.host.initialize(handshake({}))).not.toThrow();
  });

  it("fails visibly when protocol versions differ", () => {
    const bridge = createBridge({ transport: createMockTransport() });

    expect(() => bridge.host.initialize(handshake({ protocolVersion: 1 }))).toThrow(
      "Bridge contract mismatch",
    );
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "protocol host=1 sdk=2",
    );
  });

  it("compares declared core and app fingerprints", () => {
    const expectations = createExpectations();
    expectations.declare("core", "core-hash");
    expectations.declare("app", "app-hash");
    const bridge = createBridge({ transport: createMockTransport(), expectations });

    expect(() =>
      bridge.host.initialize(
        handshake({ coreFingerprint: "core-hash", appFingerprint: "app-hash" }),
      ),
    ).not.toThrow();
    expect(() =>
      bridge.host.initialize(
        handshake({ coreFingerprint: "core-hash", appFingerprint: "stale" }),
      ),
    ).toThrow("app contract fingerprint");
  });

  it("rejects a frontend built for a different access policy", () => {
    const expectations = createExpectations();
    expectations.declare("access", "expected-access");
    const bridge = createBridge({ transport: createMockTransport(), expectations });

    expect(() =>
      bridge.host.initialize(handshake({ accessFingerprint: "installed-access" })),
    ).toThrow("bridge access fingerprint");
  });

  it("skips the access check when no access fingerprint is declared", () => {
    const bridge = createBridge({ transport: createMockTransport() });

    expect(() =>
      bridge.host.initialize(handshake({ accessFingerprint: "anything" })),
    ).not.toThrow();
  });
});
