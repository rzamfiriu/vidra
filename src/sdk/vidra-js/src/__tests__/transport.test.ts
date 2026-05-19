import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  CustomSchemeTransport,
  BrowserFallbackTransport,
} from "../transport.js";

describe("CustomSchemeTransport", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("appends a hidden iframe with the vidra:// bridge scheme on send", () => {
    const t = new CustomSchemeTransport();

    t.send({ id: "req_1", module: "echo", method: "ping", payload: { n: 1 } });

    const frames = document.body.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);

    const src = frames[0].getAttribute("src") ?? "";
    expect(src.startsWith("vidra://bridge?payload=")).toBe(true);

    const decoded = decodeURIComponent(src.replace("vidra://bridge?payload=", ""));
    expect(JSON.parse(decoded)).toMatchObject({ module: "echo", method: "ping" });
  });

  it("removes the iframe shortly after send", () => {
    vi.useFakeTimers();
    const t = new CustomSchemeTransport();
    t.send({ id: "r", module: "a", method: "b" });

    expect(document.body.querySelectorAll("iframe")).toHaveLength(1);
    vi.advanceTimersByTime(200);
    expect(document.body.querySelectorAll("iframe")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("uses the vidra://reverse scheme for reverse responses", () => {
    const t = new CustomSchemeTransport();
    t.sendReverse({ id: "r", success: true, data: true });

    const src = document.body.querySelector("iframe")?.getAttribute("src") ?? "";
    expect(src.startsWith("vidra://reverse?payload=")).toBe(true);
  });
});

describe("BrowserFallbackTransport", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete (window as any).__vidra_callback;
  });

  it("delivers a BROWSER_ONLY error asynchronously", async () => {
    const t = new BrowserFallbackTransport();
    const received = new Promise<unknown>((resolve) => {
      (window as any).__vidra_callback = resolve;
    });

    t.send({ id: "req_1", module: "fs", method: "readText" });
    const response: any = await received;

    expect(response.success).toBe(false);
    expect(response.error.code).toBe("BROWSER_ONLY");
    expect(response.id).toBe("req_1");
  });

  it("warns when reverse responses are attempted", () => {
    new BrowserFallbackTransport().sendReverse({ id: "r", success: true });
    expect(warnSpy).toHaveBeenCalled();
  });
});
