import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createCustomSchemeTransport,
  createBrowserFallbackTransport,
  createNativeMessageTransport,
  detectTransport,
  hasNativeMessageChannel,
  NATIVE_CHANNEL,
} from "../transport.js";

const installAppleChannel = () => {
  const postMessage = vi.fn();
  (window as any).webkit = {
    messageHandlers: { [NATIVE_CHANNEL]: { postMessage } },
  };
  return postMessage;
};

const installWindowsChannel = () => {
  const postMessage = vi.fn();
  (window as any).chrome = { webview: { postMessage } };
  return postMessage;
};

const installAndroidChannel = () => {
  const postMessage = vi.fn();
  (window as any)[NATIVE_CHANNEL] = { postMessage };
  return postMessage;
};

const removeChannels = () => {
  delete (window as any).webkit;
  delete (window as any).chrome;
  delete (window as any)[NATIVE_CHANNEL];
  delete (window as any).__vidra_native;
};

describe("createCustomSchemeTransport", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("appends a hidden iframe with the vidra:// bridge scheme on send", () => {
    const t = createCustomSchemeTransport();

    t.send({ id: "req_1", contract: "echo", member: "ping", payload: { n: 1 } });

    const frames = document.body.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);

    const src = frames[0].getAttribute("src") ?? "";
    expect(src.startsWith("vidra://bridge?payload=")).toBe(true);

    const decoded = decodeURIComponent(src.replace("vidra://bridge?payload=", ""));
    expect(JSON.parse(decoded)).toMatchObject({ contract: "echo", member: "ping" });
  });

  it("removes the iframe shortly after send", () => {
    vi.useFakeTimers();
    const t = createCustomSchemeTransport();
    t.send({ id: "r", contract: "a", member: "b" });

    expect(document.body.querySelectorAll("iframe")).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("uses the vidra://reverse scheme for reverse responses", () => {
    const t = createCustomSchemeTransport();
    t.sendReverse({ id: "r", success: true, data: true });

    const src = document.body.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src.startsWith("vidra://reverse?payload=")).toBe(true);
  });
});

describe("createNativeMessageTransport", () => {
  afterEach(removeChannels);

  it("detects the WKWebView (Apple) channel", () => {
    expect(hasNativeMessageChannel()).toBe(false);
    installAppleChannel();
    expect(hasNativeMessageChannel()).toBe(true);
  });

  it("detects the WebView2 (Windows) channel", () => {
    expect(hasNativeMessageChannel()).toBe(false);
    installWindowsChannel();
    expect(hasNativeMessageChannel()).toBe(true);
  });

  it("detects the Android WebView channel", () => {
    expect(hasNativeMessageChannel()).toBe(false);
    installAndroidChannel();
    expect(hasNativeMessageChannel()).toBe(true);
  });

  it("posts a framed request to the Apple channel", () => {
    const postMessage = installAppleChannel();
    createNativeMessageTransport().send({
      id: "req_1",
      contract: "filesystem",
      member: "writeText",
      payload: { path: "/tmp/f.txt", content: "x".repeat(10_000) },
    });

    expect(postMessage).toHaveBeenCalledTimes(1);
    const frame = JSON.parse(postMessage.mock.calls[0][0]);
    expect(frame.kind).toBe("request");
    expect(frame.data).toMatchObject({ contract: "filesystem", member: "writeText" });
    // The large payload survives intact (no URL-length truncation).
    expect(frame.data.payload.content).toHaveLength(10_000);
  });

  it("posts a framed reverse response to the Windows channel", () => {
    const postMessage = installWindowsChannel();
    createNativeMessageTransport().sendReverse({ id: "rev_1", success: true, data: 42 });

    const frame = JSON.parse(postMessage.mock.calls[0][0]);
    expect(frame).toEqual({
      kind: "reverse",
      data: { id: "rev_1", success: true, data: 42 },
    });
  });

  it("posts a framed request to the Android channel without an iframe", () => {
    document.body.innerHTML = "";
    const postMessage = installAndroidChannel();
    createNativeMessageTransport().send({ id: "r", contract: "a", member: "b" });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toMatchObject({
      kind: "request",
      data: { id: "r", contract: "a", member: "b" },
    });
    expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("does not create iframes (unlike the custom-scheme transport)", () => {
    document.body.innerHTML = "";
    installAppleChannel();
    createNativeMessageTransport().send({ id: "r", contract: "a", member: "b" });
    expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
  });

  it("throws when created without an available channel", () => {
    expect(() => createNativeMessageTransport()).toThrow(/no native message channel/i);
  });
});

describe("createBrowserFallbackTransport", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("delivers a BROWSER_ONLY error asynchronously through the injected deliver", async () => {
    const deliver = vi.fn();
    const t = createBrowserFallbackTransport({ deliver });

    t.send({ id: "req_1", contract: "fs", member: "readText" });
    expect(deliver).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    const response = deliver.mock.calls[0][0];
    expect(response.success).toBe(false);
    expect(response.error.code).toBe("BROWSER_ONLY");
    expect(response.id).toBe("req_1");
  });

  it("warns when reverse responses are attempted", () => {
    createBrowserFallbackTransport({ deliver: vi.fn() }).sendReverse({ id: "r", success: true });
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe("detectTransport", () => {
  afterEach(removeChannels);

  it("prefers a cacheable native message channel", () => {
    const postMessage = installAppleChannel();
    const detected = detectTransport(vi.fn());

    detected.transport.send({ id: "r", contract: "a", member: "b" });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(detected.cacheable).toBe(true);
  });

  it("uses the cacheable custom-scheme transport when only the host marker is set", () => {
    document.body.innerHTML = "";
    (window as any).__vidra_native = true;
    const detected = detectTransport(vi.fn());

    detected.transport.send({ id: "r", contract: "a", member: "b" });
    expect(document.body.querySelectorAll("iframe")).toHaveLength(1);
    expect(detected.cacheable).toBe(true);
  });

  it("falls back to a non-cacheable browser stub so a late native channel is still picked up", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const deliver = vi.fn();
    const detected = detectTransport(deliver);

    detected.transport.send({ id: "r", contract: "a", member: "b" });
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(detected.cacheable).toBe(false);
    warnSpy.mockRestore();
  });
});
