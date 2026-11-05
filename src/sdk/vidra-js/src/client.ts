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
import { type Transport, detectTransport } from "./transport.js";

const PROTOCOL_VERSION = 2;
const EMPTY_FINGERPRINT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/**
 * Which build artefact a fingerprint declaration describes:
 * - `core`: the SDK's generated built-in contracts
 * - `app`: the application's generated contracts
 * - `access`: the bridge access policy the frontend was built against
 */
export type ExpectationScope = "core" | "app" | "access";

/**
 * Write-once record of the fingerprints this frontend was generated against.
 * Generated barrels and the CLI declare into it while modules evaluate; the
 * bridge reads it when the host sends its handshake.
 */
export interface Expectations {
  /**
   * Declare the fingerprint for a scope. Declaring the same value again is a
   * no-op; a different value for an already-declared scope throws, because two
   * generated modules for the same scope are loaded in one page.
   */
  declare: (scope: ExpectationScope, fingerprint: string) => void;
  get: (scope: ExpectationScope) => string | undefined;
}

export const createExpectations = (): Expectations => {
  const declared = new Map<ExpectationScope, string>();

  return {
    declare: (scope, fingerprint) => {
      const existing = declared.get(scope);
      if (existing !== undefined && existing !== fingerprint) {
        throw new Error(
          `[vidra] Conflicting ${scope} fingerprint declarations (${existing} vs ${fingerprint}). Two generated modules for the same scope are loaded; regenerate TypeScript contracts.`,
        );
      }
      declared.set(scope, fingerprint);
    },
    get: (scope) => declared.get(scope),
  };
};

export interface UnsafeVidra {
  invoke: <T = unknown>(
    contract: string,
    member: string,
    payload?: unknown,
  ) => Promise<T>;

  on: <T = unknown>(
    contract: string,
    member: string,
    handler: EventHandler<T>,
  ) => () => void;

  handle: <TPayload = unknown, TResult = unknown>(
    contract: string,
    member: string,
    handler: JsHandler<TPayload, TResult>,
  ) => () => void;
}

/** Entry points the native host calls into; `installWindowCallbacks` exposes
 * them as the `window.__vidra_*` functions the host protocol expects. */
export interface HostEntryPoints {
  deliverResponse: (response: BridgeResponse) => void;
  dispatchEvent: (event: BridgeEvent) => void;
  invokeHandler: (request: ReverseRequest) => Promise<void>;
  initialize: (handshake: BridgeHandshake) => void;
}

export interface VidraBridge {
  readonly unsafe: UnsafeVidra;
  /** Query which contracts and members are available on the native side. */
  readonly capabilities: () => Promise<Capabilities>;
  readonly host: HostEntryPoints;
}

export interface BridgeOptions {
  /** Override the transport layer (auto-detected on first use by default). */
  transport?: Transport;
  /** Timeout in ms for invoke calls. Default: 30_000 */
  timeout?: number;
  /** Fingerprints to compare against the host handshake. Default: none declared. */
  expectations?: Expectations;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Build a bridge with its own request correlation, listeners, and handlers.
 * Pure apart from the transport it eventually sends on: nothing is written to
 * `window` until `installWindowCallbacks` is called.
 */
export const createBridge = (options: BridgeOptions = {}): VidraBridge => {
  const timeout = options.timeout ?? 30_000;
  const expectations = options.expectations ?? createExpectations();
  const pending = new Map<string, PendingRequest>();
  const listeners = new Map<string, Set<EventHandler>>();
  const handlers = new Map<string, JsHandler>();
  let idCounter = 0;
  let cachedTransport = options.transport;

  const nextId = (): string => `req_${++idCounter}_${Date.now()}`;

  const deliverResponse = (response: BridgeResponse): void => {
    const entry = pending.get(response.id);
    if (!entry) return;

    pending.delete(response.id);

    if (response.success) {
      entry.resolve(response.data);
    } else {
      entry.reject(
        new Error(
          response.error
            ? `[${response.error.code}] ${response.error.message}`
            : "Unknown native error",
        ),
      );
    }
  };

  const transport = (): Transport => {
    if (cachedTransport) return cachedTransport;

    const detected = detectTransport(deliverResponse);
    if (detected.cacheable) {
      cachedTransport = detected.transport;
    }
    return detected.transport;
  };

  const invoke = <T = unknown>(
    contract: string,
    member: string,
    payload?: unknown,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId();

      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(`[vidra] Timeout after ${timeout}ms for ${contract}.${member}`),
        );
      }, timeout);

      pending.set(id, {
        resolve: (data) => {
          clearTimeout(timer);
          resolve(data as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });

      const request: BridgeRequest = { id, contract, member, payload };
      transport().send(request);
    });

  const on = <T = unknown>(
    contract: string,
    member: string,
    handler: EventHandler<T>,
  ): (() => void) => {
    const key = contractKey(contract, member);
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(handler as EventHandler);
    return () => listeners.get(key)?.delete(handler as EventHandler);
  };

  const handle = <TPayload = unknown, TResult = unknown>(
    contract: string,
    member: string,
    handler: JsHandler<TPayload, TResult>,
  ): (() => void) => {
    const key = contractKey(contract, member);
    if (handlers.has(key)) {
      throw new Error(
        `[vidra] JavaScript handler '${contract}.${member}' is already registered.`,
      );
    }

    const registered = handler as JsHandler;
    handlers.set(key, registered);
    return () => {
      if (handlers.get(key) === registered) {
        handlers.delete(key);
      }
    };
  };

  const capabilities = (): Promise<Capabilities> =>
    invoke<Capabilities>("__bridge", "capabilities");

  const dispatchEvent = (event: BridgeEvent): void => {
    const set = listeners.get(contractKey(event.contract, event.member));
    if (!set) return;
    for (const handler of set) {
      try {
        handler(event.payload);
      } catch (e) {
        console.error(
          `[vidra] Error in event handler for '${event.contract}.${event.member}':`,
          e,
        );
      }
    }
  };

  const invokeHandler = async (request: ReverseRequest): Promise<void> => {
    const handler = handlers.get(contractKey(request.contract, request.member));
    const respond = (response: ReverseResponse): void =>
      transport().sendReverse(response);

    if (!handler) {
      respond({
        id: request.id,
        success: false,
        error: {
          code: "JS_HANDLER_NOT_FOUND",
          message: `No JavaScript handler registered for '${request.contract}.${request.member}'.`,
        },
      });
      return;
    }

    try {
      const result = await handler(request.payload);
      respond({ id: request.id, success: true, data: result });
    } catch (e) {
      respond({
        id: request.id,
        success: false,
        error: {
          code: "JS_HANDLER_ERROR",
          message: e instanceof Error ? e.message : String(e),
        },
      });
    }
  };

  const initialize = (handshake: BridgeHandshake): void => {
    const mismatches: string[] = [];
    if (handshake.protocolVersion !== PROTOCOL_VERSION) {
      mismatches.push(
        `protocol host=${handshake.protocolVersion} sdk=${PROTOCOL_VERSION}`,
      );
    }
    if (handshake.coreFingerprint !== (expectations.get("core") ?? EMPTY_FINGERPRINT)) {
      mismatches.push("core contract fingerprint");
    }
    if (handshake.appFingerprint !== (expectations.get("app") ?? EMPTY_FINGERPRINT)) {
      mismatches.push("app contract fingerprint");
    }
    const expectedAccess = expectations.get("access");
    if (expectedAccess !== undefined && handshake.accessFingerprint !== expectedAccess) {
      mismatches.push("bridge access fingerprint");
    }

    if (mismatches.length === 0) return;

    const message = `[vidra] Bridge contract mismatch: ${mismatches.join(", ")}. Rebuild the host and regenerate TypeScript contracts.`;
    renderBridgeError(message);
    throw new Error(message);
  };

  return {
    unsafe: { invoke, on, handle },
    capabilities,
    host: { deliverResponse, dispatchEvent, invokeHandler, initialize },
  };
};

/**
 * Expose a bridge's host entry points as the `window.__vidra_*` functions the
 * native host calls. Returns an uninstaller that removes only the functions it
 * installed: when another bridge has been installed since (tests install one
 * per case), its callbacks are left in place.
 */
export const installWindowCallbacks = (bridge: VidraBridge): (() => void) => {
  const target = window as unknown as Record<string, unknown>;
  const callbacks: Record<string, unknown> = {
    __vidra_callback: bridge.host.deliverResponse,
    __vidra_onevent: bridge.host.dispatchEvent,
    __vidra_invoke: bridge.host.invokeHandler,
    __vidra_initialize: bridge.host.initialize,
  };

  for (const [name, callback] of Object.entries(callbacks)) {
    target[name] = callback;
  }

  return () => {
    for (const [name, callback] of Object.entries(callbacks)) {
      if (target[name] === callback) {
        delete target[name];
      }
    }
  };
};

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
