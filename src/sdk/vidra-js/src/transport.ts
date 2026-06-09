import type { BridgeRequest, BridgeResponse, ReverseResponse } from "./types.js";

/**
 * Abstraction over the JS→C# transport mechanism.
 * The default implementation uses the custom-scheme navigation approach
 * (`vidra://bridge?payload=...`) which the MAUI WebViewBridge intercepts.
 */
export interface Transport {
  send(request: BridgeRequest): void;
  sendReverse(response: ReverseResponse): void;
}

/**
 * The script-message handler name registered by the native host. JS posts to
 * `window.webkit.messageHandlers[NATIVE_CHANNEL]` (WKWebView) or, on Windows,
 * to `window.chrome.webview` (WebView2).
 */
export const NATIVE_CHANNEL = "vidra";

/** Tagged envelope used on the native message channel to disambiguate requests
 * from reverse-RPC responses (the custom-scheme transport uses separate URLs). */
type NativeFrame =
  | { kind: "request"; data: BridgeRequest }
  | { kind: "reverse"; data: ReverseResponse };

interface NativePoster {
  postMessage(message: string): void;
}

const appleChannel = (): NativePoster | undefined => {
  const handler = (globalThis as any)?.webkit?.messageHandlers?.[NATIVE_CHANNEL];
  return handler && typeof handler.postMessage === "function" ? handler : undefined;
};

const windowsChannel = (): NativePoster | undefined => {
  const webview = (globalThis as any)?.chrome?.webview;
  return webview && typeof webview.postMessage === "function" ? webview : undefined;
};

/** True when a first-class native message channel (WKWebView or WebView2) is
 * available. Preferred over the custom-scheme transport because it has no URL
 * length limit, no per-message iframe, and is binary-safe. */
export const hasNativeMessageChannel = (): boolean =>
  appleChannel() !== undefined || windowsChannel() !== undefined;

/**
 * Transport that uses the platform's native message channel:
 * - Apple (WKWebView): `window.webkit.messageHandlers.vidra.postMessage(...)`
 *   handled by a `WKScriptMessageHandler` on the C# side.
 * - Windows (WebView2): `window.chrome.webview.postMessage(...)` handled by
 *   `CoreWebView2.WebMessageReceived` on the C# side.
 *
 * Unlike {@link CustomSchemeTransport}, payloads are not URL-encoded into a
 * navigation, so large messages (e.g. file contents) are not truncated.
 */
export class NativeMessageTransport implements Transport {
  private readonly channel: NativePoster;

  constructor(channel: NativePoster | undefined = appleChannel() ?? windowsChannel()) {
    if (!channel) {
      throw new Error(
        "[vidra] No native message channel is available (expected WKWebView or WebView2).",
      );
    }
    this.channel = channel;
  }

  send(request: BridgeRequest): void {
    this.post({ kind: "request", data: request });
  }

  sendReverse(response: ReverseResponse): void {
    this.post({ kind: "reverse", data: response });
  }

  private post(frame: NativeFrame): void {
    this.channel.postMessage(JSON.stringify(frame));
  }
}

export class CustomSchemeTransport implements Transport {
  send(request: BridgeRequest): void {
    const json = JSON.stringify(request);
    const encoded = encodeURIComponent(json);
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `vidra://bridge?payload=${encoded}`;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 100);
  }

  sendReverse(response: ReverseResponse): void {
    const json = JSON.stringify(response);
    const encoded = encodeURIComponent(json);
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `vidra://reverse?payload=${encoded}`;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 100);
  }
}

/**
 * Browser-only stub that immediately resolves with a synthetic response.
 * Enables UI development in a regular browser without the MAUI shell.
 */
export class BrowserFallbackTransport implements Transport {
  send(request: BridgeRequest): void {
    console.warn(
      `[vidra] No native host detected. Browser stub for: ${request.module}.${request.method}`,
      request
    );

    queueMicrotask(() => {
      const callback = (window as any).__vidra_callback;
      if (typeof callback === "function") {
        const response: BridgeResponse = {
          id: request.id,
          success: false,
          error: {
            code: "BROWSER_ONLY",
            message: `Native host not available. '${request.module}.${request.method}' requires the MAUI shell.`,
          },
        };
        callback(response);
      }
    });
  }

  sendReverse(_response: ReverseResponse): void {
    console.warn("[vidra] Reverse RPC is not available in browser-only mode.");
  }
}
