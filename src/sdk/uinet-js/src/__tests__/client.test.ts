import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { UINetClient } from "../client.js";
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
  (window as any).__uinet_callback(response);
};

const dispatchEvent = (event: BridgeEvent): void => {
  (window as any).__uinet_onevent(event);
};

const dispatchReverse = (request: ReverseRequest): void => {
  (window as any).__uinet_invoke(request);
};

describe("UINetClient.invoke", () => {
  let transport: MockTransport;
  let client: UINetClient;

  beforeEach(() => {
    transport = new MockTransport();
    client = new UINetClient({ transport });
  });

  it("resolves with success data", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: true, data: { text: "hi" } });

    const result = await client.invoke<{ text: string }>("echo", "ping", { text: "hi" });
    expect(result).toEqual({ text: "hi" });
  });

  it("sends the request through the transport", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: true });
    await client.invoke("echo", "ping", { n: 1 });

    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]).toMatchObject({
      module: "echo",
      method: "ping",
      payload: { n: 1 },
    });
    expect(transport.sent[0].id).toMatch(/^req_/);
  });

  it("rejects with formatted error when native responds with error", async () => {
    transport.onSend = (req) =>
      deliver({
        id: req.id,
        success: false,
        error: { code: "MODULE_NOT_FOUND", message: "No module 'x'" },
      });

    await expect(client.invoke("x", "y")).rejects.toThrow("[MODULE_NOT_FOUND] No module 'x'");
  });

  it("rejects with generic message if error body missing", async () => {
    transport.onSend = (req) => deliver({ id: req.id, success: false });

    await expect(client.invoke("x", "y")).rejects.toThrow("Unknown native error");
  });

  it("rejects with timeout if no response arrives", async () => {
    vi.useFakeTimers();
    const clientWithTimeout = new UINetClient({ transport, timeout: 50 });
    const promise = clientWithTimeout.invoke("slow", "op");

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

    const result = await client.invoke("echo", "ping").then((r) => {
      spy(r);
      return r;
    });

    expect(result).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("UINetClient events", () => {
  let transport: MockTransport;
  let client: UINetClient;

  beforeEach(() => {
    transport = new MockTransport();
    client = new UINetClient({ transport });
  });

  it("delivers events to subscribed handlers", () => {
    const handler = vi.fn();
    client.on<{ x: number }>("tick", handler);

    dispatchEvent({ event: "tick", data: { x: 1 } });
    dispatchEvent({ event: "tick", data: { x: 2 } });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, { x: 1 });
    expect(handler).toHaveBeenNthCalledWith(2, { x: 2 });
  });

  it("supports multiple handlers per event", () => {
    const a = vi.fn();
    const b = vi.fn();
    client.on("tick", a);
    client.on("tick", b);

    dispatchEvent({ event: "tick", data: null });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("returns an unsubscribe function", () => {
    const handler = vi.fn();
    const off = client.on("tick", handler);
    off();

    dispatchEvent({ event: "tick", data: null });
    expect(handler).not.toHaveBeenCalled();
  });

  it("isolates exceptions in one handler from others", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = vi.fn(() => {
      throw new Error("boom");
    });
    const good = vi.fn();

    client.on("tick", bad);
    client.on("tick", good);

    dispatchEvent({ event: "tick", data: null });

    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ignores events that no one is subscribed to", () => {
    expect(() => dispatchEvent({ event: "unhandled", data: null })).not.toThrow();
  });
});

describe("UINetClient reverse RPC", () => {
  let transport: MockTransport;
  let client: UINetClient;

  beforeEach(() => {
    transport = new MockTransport();
    client = new UINetClient({ transport });
  });

  it("responds with HANDLER_NOT_FOUND when no handler is registered", async () => {
    dispatchReverse({ id: "rev_1", handler: "confirm" });
    await Promise.resolve();

    expect(transport.sentReverse).toHaveLength(1);
    expect(transport.sentReverse[0]).toMatchObject({
      id: "rev_1",
      success: false,
      error: { code: "HANDLER_NOT_FOUND" },
    });
  });

  it("dispatches matching handlers and returns their result", async () => {
    client.handle<{ message: string }, boolean>("confirm", async () => true);
    dispatchReverse({ id: "rev_2", handler: "confirm", payload: { message: "?" } });

    await vi.waitFor(() => expect(transport.sentReverse).toHaveLength(1));
    expect(transport.sentReverse[0]).toEqual({ id: "rev_2", success: true, data: true });
  });

  it("wraps handler exceptions as HANDLER_ERROR", async () => {
    client.handle("boom", () => {
      throw new Error("something broke");
    });
    dispatchReverse({ id: "rev_3", handler: "boom" });

    await vi.waitFor(() => expect(transport.sentReverse).toHaveLength(1));
    expect(transport.sentReverse[0]).toMatchObject({
      id: "rev_3",
      success: false,
      error: { code: "HANDLER_ERROR", message: "something broke" },
    });
  });

  it("unsubscribing a handler restores the HANDLER_NOT_FOUND response", async () => {
    const unsubscribe = client.handle("confirm", () => true);
    unsubscribe();

    dispatchReverse({ id: "rev_4", handler: "confirm" });
    await Promise.resolve();

    expect(transport.sentReverse[0]).toMatchObject({
      success: false,
      error: { code: "HANDLER_NOT_FOUND" },
    });
  });
});

describe("UINetClient.capabilities", () => {
  it("invokes the reserved __bridge.capabilities method", async () => {
    const transport = new MockTransport();
    transport.onSend = (req) =>
      deliver({ id: req.id, success: true, data: { echo: ["ping"] } });
    const client = new UINetClient({ transport });

    const caps = await client.capabilities();
    expect(caps).toEqual({ echo: ["ping"] });
    expect(transport.sent[0]).toMatchObject({ module: "__bridge", method: "capabilities" });
  });
});

describe("UINetClient transport selection", () => {
  afterEach(() => {
    delete (window as any).__uinet_native;
  });

  it("uses the explicit transport when provided", async () => {
    const transport = new MockTransport();
    transport.onSend = (req) => deliver({ id: req.id, success: true });
    const client = new UINetClient({ transport });

    await client.invoke("x", "y");
    expect(transport.sent).toHaveLength(1);
  });
});
