import type { BridgeRequest, BridgeResponse, ReverseResponse } from "./types.js";

/**
 * Abstraction over the JS→C# transport mechanism.
 * The default implementation uses the custom-scheme navigation approach
 * (`uinet://bridge?payload=...`) which the MAUI WebViewBridge intercepts.
 */
export interface Transport {
  send(request: BridgeRequest): void;
  sendReverse(response: ReverseResponse): void;
}

export class CustomSchemeTransport implements Transport {
  send(request: BridgeRequest): void {
    const json = JSON.stringify(request);
    const encoded = encodeURIComponent(json);
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `uinet://bridge?payload=${encoded}`;
    document.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 100);
  }

  sendReverse(response: ReverseResponse): void {
    const json = JSON.stringify(response);
    const encoded = encodeURIComponent(json);
    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = `uinet://reverse?payload=${encoded}`;
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
      `[uinet] No native host detected. Browser stub for: ${request.module}.${request.method}`,
      request
    );

    queueMicrotask(() => {
      const callback = (window as any).__uinet_callback;
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
    console.warn("[uinet] Reverse RPC is not available in browser-only mode.");
  }
}
