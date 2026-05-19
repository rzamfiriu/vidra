import type {
  BridgeRequest,
  BridgeResponse,
  BridgeEvent,
  EventHandler,
  Capabilities,
  ReverseRequest,
  ReverseResponse,
  JsHandler,
} from "./types.js";
import {
  Transport,
  CustomSchemeTransport,
  BrowserFallbackTransport,
} from "./transport.js";

let _idCounter = 0;
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

  constructor(options: VidraClientOptions = {}) {
    this.timeout = options.timeout ?? 30_000;
    this._explicitTransport = options.transport;

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
  }

  /**
   * Lazily resolve the transport on first use. By the time the user interacts
   * with the app, the C# host has had time to inject `window.__vidra_native`.
   */
  private get transport(): Transport {
    if (!this._transport) {
      this._transport =
        this._explicitTransport ??
        (isNativeHost() ? new CustomSchemeTransport() : new BrowserFallbackTransport());
    }
    return this._transport;
  }

  /**
   * Invoke a native module method and wait for the result.
   *
   * @example
   * const { content } = await vidra.invoke<{ content: string }>('filesystem', 'readText', { path: '/tmp/f.txt' });
   */
  invoke<T = unknown>(module: string, method: string, payload?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = nextId();

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[vidra] Timeout after ${this.timeout}ms for ${module}.${method}`));
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

      const request: BridgeRequest = { id, module, method, payload };
      this.transport.send(request);
    });
  }

  /** Register a handler that C# can invoke via reverse RPC. Returns an unsubscribe function. */
  handle<TPayload = unknown, TResult = unknown>(
    name: string,
    handler: JsHandler<TPayload, TResult>,
  ): () => void {
    this.handlers.set(name, handler as JsHandler);
    return () => this.handlers.delete(name);
  }

  /** Subscribe to events pushed from C# (e.g. `app.resume`, `app.themeChanged`). */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as EventHandler);
    return () => this.listeners.get(event)?.delete(handler as EventHandler);
  }

  /** Query which modules and methods are available on the native side. */
  async capabilities(): Promise<Capabilities> {
    return this.invoke<Capabilities>("__bridge", "capabilities");
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
    const handlers = this.listeners.get(event.event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(event.data);
      } catch (e) {
        console.error(`[vidra] Error in event handler for '${event.event}':`, e);
      }
    }
  }

  private async handleReverseCall(request: ReverseRequest): Promise<void> {
    const handler = this.handlers.get(request.handler);

    if (!handler) {
      const response: ReverseResponse = {
        id: request.id,
        success: false,
        error: {
          code: "HANDLER_NOT_FOUND",
          message: `No JS handler registered for '${request.handler}'.`,
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
          code: "HANDLER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        },
      };
      this.transport.sendReverse(response);
    }
  }
}

const isNativeHost = (): boolean => {
  // The native host injects this marker before the web content loads.
  return typeof (window as any).__vidra_native !== "undefined";
};
