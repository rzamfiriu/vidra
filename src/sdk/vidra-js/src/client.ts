import type {
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
  EventHandler,
  Capabilities,
  ReverseRequest,
  ReverseResponse,
  JsHandler,
  BridgeHandshake,
} from "./types.js";
import {
  Transport,
  CustomSchemeTransport,
  BrowserFallbackTransport,
  NativeMessageTransport,
  hasNativeMessageChannel,
} from "./transport.js";

let _idCounter = 0;
const PROTOCOL_VERSION = 2;
const EMPTY_FINGERPRINT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const nextId = (): string => {
  return `req_${++_idCounter}_${Date.now()}`;
};

export interface VidraClientOptions {
  /** Override the transport layer (auto-detected by default). */
  transport?: Transport;
  /** Timeout in ms for invoke calls. Default: 30_000 */
  timeout?: number;
}

export class VidraClient {
  private _explicitTransport?: Transport;
  private _transport?: Transport;
  private timeout: number;
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private listeners = new Map<string, Set<EventHandler>>();
  private handlers = new Map<string, JsHandler>();
  private coreFingerprint = EMPTY_FINGERPRINT;
  private appFingerprint = EMPTY_FINGERPRINT;
  readonly unsafe: UnsafeVidraClient;

  constructor(options: VidraClientOptions = {}) {
    this.timeout = options.timeout ?? 30_000;
    this._explicitTransport = options.transport;
    this.unsafe = {
      invoke: <T = unknown>(
        contract: string,
        member: string,
        payload?: unknown,
      ) => this.invokeUnsafe<T>(contract, member, payload),
      on: <T = unknown>(
        contract: string,
        member: string,
        handler: EventHandler<T>,
      ) => this.onUnsafe(contract, member, handler),
      handle: <TPayload = unknown, TResult = unknown>(
        contract: string,
        member: string,
        handler: JsHandler<TPayload, TResult>,
      ) => this.handleUnsafe(contract, member, handler),
    };

    // The C# side calls window.__vidra_callback(response) to deliver results.
    (window as any).__vidra_callback = (response: BridgeResponse) => {
      this.handleResponse(response);
    };

    // The C# side calls window.__vidra_onevent(event) to push events.
    (window as any).__vidra_onevent = (event: BridgeEvent) => {
      this.handleEvent(event);
    };

    // The C# side calls window.__vidra_invoke(request) for reverse RPC.
    (window as any).__vidra_invoke = (request: ReverseRequest) => {
      this.handleReverseCall(request);
    };

    (window as any).__vidra_initialize = (handshake: BridgeHandshake) => {
      this.initialize(handshake);
    };
  }

  /** @internal Used by generated contract barrels. */
  registerGeneratedManifest(scope: "core" | "app", fingerprint: string): void {
    if (scope === "core") {
      this.coreFingerprint = fingerprint;
    } else {
      this.appFingerprint = fingerprint;
    }
  }

  /**
   * Lazily resolve the transport on first use. Preference order:
   *   1. an explicitly supplied transport
   *   2. the native message channel (WKWebView / WebView2) when present
   *   3. the custom-scheme transport when the host marker is set
   *   4. the browser-only fallback
   *
   * The browser fallback is intentionally never cached: a native channel can
   * become available shortly after load (e.g. the WKWebView script-message
   * handler registers just after the page loads), so we keep re-detecting until
   * a real native transport is found.
   */
  private get transport(): Transport {
    if (this._explicitTransport) return this._explicitTransport;
    if (this._transport) return this._transport;

    const detected = this.detectTransport();
    if (!(detected instanceof BrowserFallbackTransport)) {
      this._transport = detected;
    }
    return detected;
  }

  private detectTransport(): Transport {
    if (hasNativeMessageChannel()) return new NativeMessageTransport();
    if (isNativeHost()) return new CustomSchemeTransport();
    return new BrowserFallbackTransport();
  }

  /** @internal Called by the explicit unsafe API and generated proxies. */
  private invokeUnsafe<T = unknown>(
    contract: string,
    member: string,
    payload?: unknown,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId();

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `[vidra] Timeout after ${this.timeout}ms for ${contract}.${member}`,
          ),
        );
      }, this.timeout);

      this.pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data as T);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      const request: BridgeRequest = { id, contract, member, payload };
      this.transport.send(request);
    });
  }

  /** @internal Called by the explicit unsafe API and generated JS contracts. */
  private handleUnsafe<TPayload = unknown, TResult = unknown>(
    contract: string,
    member: string,
    handler: JsHandler<TPayload, TResult>,
  ): () => void {
    const key = contractKey(contract, member);
    if (this.handlers.has(key)) {
      throw new Error(
        `[vidra] JavaScript handler '${contract}.${member}' is already registered.`,
      );
    }

    const registered = handler as JsHandler;
    this.handlers.set(key, registered);
    return () => {
      if (this.handlers.get(key) === registered) {
        this.handlers.delete(key);
      }
    };
  }

  /** @internal Called by the explicit unsafe API and generated event methods. */
  private onUnsafe<T = unknown>(
    contract: string,
    member: string,
    handler: EventHandler<T>,
  ): () => void {
    const key = contractKey(contract, member);
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(handler as EventHandler);
    return () => this.listeners.get(key)?.delete(handler as EventHandler);
  }

  /** Query which modules and methods are available on the native side. */
  async capabilities(): Promise<Capabilities> {
    return this.invokeUnsafe<Capabilities>("__bridge", "capabilities");
  }

  private handleResponse(response: BridgeResponse): void {
    const entry = this.pending.get(response.id);
    if (!entry) return;

    this.pending.delete(response.id);

    if (response.success) {
      entry.resolve(response.data);
    } else {
      entry.reject(
        new Error(
          response.error
            ? `[${response.error.code}] ${response.error.message}`
            : "Unknown native error"
        )
      );
    }
  }

  private handleEvent(event: BridgeEvent): void {
    const key = contractKey(event.contract, event.member);
    const handlers = this.listeners.get(key);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event.payload);
      } catch (e) {
        console.error(
          `[vidra] Error in event handler for '${event.contract}.${event.member}':`,
          e,
        );
      }
    }
  }

  private async handleReverseCall(request: ReverseRequest): Promise<void> {
    const key = contractKey(request.contract, request.member);
    const handler = this.handlers.get(key);

    if (!handler) {
      const response: ReverseResponse = {
        id: request.id,
        success: false,
        error: {
          code: "JS_HANDLER_NOT_FOUND",
          message: `No JavaScript handler registered for '${request.contract}.${request.member}'.`,
        },
      };
      this.transport.sendReverse(response);
      return;
    }

    try {
      const result = await handler(request.payload);
      const response: ReverseResponse = {
        id: request.id,
        success: true,
        data: result,
      };
      this.transport.sendReverse(response);
    } catch (e) {
      const response: ReverseResponse = {
        id: request.id,
        success: false,
        error: {
          code: "JS_HANDLER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        },
      };
      this.transport.sendReverse(response);
    }
  }

  private initialize(handshake: BridgeHandshake): void {
    const mismatches: string[] = [];
    if (handshake.protocolVersion !== PROTOCOL_VERSION) {
      mismatches.push(
        `protocol host=${handshake.protocolVersion} sdk=${PROTOCOL_VERSION}`,
      );
    }
    if (handshake.coreFingerprint !== this.coreFingerprint) {
      mismatches.push("core contract fingerprint");
    }
    if (handshake.appFingerprint !== this.appFingerprint) {
      mismatches.push("app contract fingerprint");
    }

    if (mismatches.length === 0) return;

    const message = `[vidra] Bridge contract mismatch: ${mismatches.join(", ")}. Rebuild the host and regenerate TypeScript contracts.`;
    renderBridgeError(message);
    throw new Error(message);
  }
}

export interface UnsafeVidraClient {
  invoke<T = unknown>(
    contract: string,
    member: string,
    payload?: unknown,
  ): Promise<T>;

  on<T = unknown>(
    contract: string,
    member: string,
    handler: EventHandler<T>,
  ): () => void;

  handle<TPayload = unknown, TResult = unknown>(
    contract: string,
    member: string,
    handler: JsHandler<TPayload, TResult>,
  ): () => void;
}

const contractKey = (contract: string, member: string): string =>
  `${contract}\u0000${member}`;

const renderBridgeError = (message: string): void => {
  if (typeof document === "undefined" || !document.body) return;

  const pre = document.createElement("pre");
  pre.setAttribute("role", "alert");
  pre.style.cssText =
    "white-space:pre-wrap;padding:24px;margin:24px;border:1px solid #b91c1c;color:#b91c1c;background:#fef2f2;font:14px/1.5 monospace";
  pre.textContent = message;
  document.body.replaceChildren(pre);
};

const isNativeHost = (): boolean => {
  // The native host injects this marker before the web content loads.
  return typeof (window as any).__vidra_native !== "undefined";
};
