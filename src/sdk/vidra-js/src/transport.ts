import type { BridgeRequest, BridgeResponse, ReverseResponse } from "./types.js";

/**
 * Abstraction over the JS→C# transport mechanism.
 * The default implementation uses the custom-scheme navigation approach
 * (`vidra://bridge?payload=...`) which the MAUI WebViewBridge intercepts.
 */
export interface Transport {
  send: (request: BridgeRequest) => void;
  sendReverse: (response: ReverseResponse) => void;
}

/**
 * The script-message handler name registered by the native host. JS posts to
 * `window.webkit.messageHandlers[NATIVE_CHANNEL]` (WKWebView) or, on Windows,
 * to `window.chrome.webview` (WebView2), or directly to
 * `window[NATIVE_CHANNEL]` (Android WebView).
 */
export const NATIVE_CHANNEL = "vidra";

/** Tagged envelope used on the native message channel to disambiguate requests
 * from reverse-RPC responses (the custom-scheme transport uses separate URLs). */
type NativeFrame =
  | { kind: "request"; data: BridgeRequest }
  | { kind: "reverse"; data: ReverseResponse };

export interface NativePoster {
  postMessage: (message: string) => void;
}

const appleChannel = (): NativePoster | undefined => {
  const handler = (globalThis as any)?.webkit?.messageHandlers?.[NATIVE_CHANNEL];
  return handler && typeof handler.postMessage === "function" ? handler : undefined;
};

const windowsChannel = (): NativePoster | undefined => {
  const webview = (globalThis as any)?.chrome?.webview;
  return webview && typeof webview.postMessage === "function" ? webview : undefined;
};

const androidChannel = (): NativePoster | undefined => {
  const bridge = (globalThis as any)?.[NATIVE_CHANNEL];
  return bridge && typeof bridge.postMessage === "function" ? bridge : undefined;
};

const nativeChannel = (): NativePoster | undefined =>
  appleChannel() ?? windowsChannel() ?? androidChannel();

/** True when a first-class native message channel is
 * available. Preferred over the custom-scheme transport because it has no URL
 * length limit, no per-message iframe, and is binary-safe. */
export const hasNativeMessageChannel = (): boolean => nativeChannel() !== undefined;

/** True when the native host has injected its marker before the web content
 * loaded, meaning custom-scheme navigations will be intercepted. */
export const isNativeHost = (): boolean =>
  typeof (window as any).__vidra_native !== "undefined";

/**
 * Transport that uses the platform's native message channel:
 * - Apple (WKWebView): `window.webkit.messageHandlers.vidra.postMessage(...)`
 *   handled by a `WKScriptMessageHandler` on the C# side.
 * - Windows (WebView2): `window.chrome.webview.postMessage(...)` handled by
 *   `CoreWebView2.WebMessageReceived` on the C# side.
 * - Android: `window.vidra.postMessage(...)` handled by an
 *   origin-scoped AndroidX WebKit message listener on the C# side.
 *
 * Unlike {@link createCustomSchemeTransport}, payloads are not URL-encoded into
 * a navigation, so large messages (e.g. file contents) are not truncated.
 *
 * Throws when no channel is available.
 */
export const createNativeMessageTransport = (
  channel: NativePoster | undefined = nativeChannel(),
): Transport => {
  if (!channel) {
    throw new Error(
      "[vidra] No native message channel is available (expected WKWebView, WebView2, or Android WebView).",
    );
  }

  const post = (frame: NativeFrame): void => {
    channel.postMessage(JSON.stringify(frame));
  };

  return {
    send: (request) => post({ kind: "request", data: request }),
    sendReverse: (response) => post({ kind: "reverse", data: response }),
  };
};

/**
 * Transport that navigates a hidden iframe to `vidra://bridge?payload=...` or
 * `vidra://reverse?payload=...`, which the MAUI host intercepts.
 */
export const createCustomSchemeTransport = (): Transport => {
  const navigate = (route: string, body: unknown): void => {
    const encoded = encodeURIComponent(JSON.stringify(body));
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `vidra://${route}?payload=${encoded}`;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 100);
  };

  return {
    send: (request) => navigate("bridge", request),
    sendReverse: (response) => navigate("reverse", response),
  };
};

export interface BrowserFallbackOptions {
  /** Receives the synthetic BROWSER_ONLY error response for each request. */
  deliver: (response: BridgeResponse) => void;
}

/**
 * Browser-only stub that immediately resolves with a synthetic response.
 * Enables UI development in a regular browser without the MAUI shell.
 */
export const createBrowserFallbackTransport = ({
  deliver,
}: BrowserFallbackOptions): Transport => ({
  send: (request) => {
    console.warn(
      `[vidra] No native host detected. Browser stub for: ${request.contract}.${request.member}`,
      request,
    );

    queueMicrotask(() => {
      deliver({
        id: request.id,
        success: false,
        error: {
          code: "BROWSER_ONLY",
          message: `Native host not available. '${request.contract}.${request.member}' requires the MAUI shell.`,
        },
      });
    });
  },
  sendReverse: () => {
    console.warn("[vidra] Reverse RPC is not available in browser-only mode.");
  },
});

export interface TransportDetection {
  transport: Transport;
  /**
   * False for the browser fallback: a native channel can become available
   * shortly after load (the WKWebView script-message handler registers just
   * after the page loads), so callers keep re-detecting until a real native
   * transport is found.
   */
  cacheable: boolean;
}

/**
 * Pick the transport for the current page. Preference order:
 *   1. the native message channel (WKWebView / WebView2 / Android) when present
 *   2. the custom-scheme transport when the host marker is set
 *   3. the browser-only fallback
 */
export const detectTransport = (
  deliver: (response: BridgeResponse) => void,
): TransportDetection => {
  if (hasNativeMessageChannel()) {
    return { transport: createNativeMessageTransport(), cacheable: true };
  }
  if (isNativeHost()) {
    return { transport: createCustomSchemeTransport(), cacheable: true };
  }
  return { transport: createBrowserFallbackTransport({ deliver }), cacheable: false };
};
