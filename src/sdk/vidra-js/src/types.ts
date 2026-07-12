export interface BridgeRequest {
  id: string;
  contract: string;
  member: string;
  payload?: unknown;
}

export interface BridgeResponse<T = unknown> {
  id: string;
  success: boolean;
  data?: T;
  error?: BridgeError;
}

export interface BridgeError {
  code: string;
  message: string;
}

export interface BridgeEvent<T = unknown> {
  contract: string;
  member: string;
  payload?: T;
}

export type EventHandler<T = unknown> = (data: T) => void;

export interface NativeContractCapabilities {
  methods: string[];
  events: string[];
}

export interface Capabilities {
  protocolVersion: number;
  nativeContracts: Record<string, NativeContractCapabilities>;
}

export interface BridgeHandshake {
  protocolVersion: number;
  coreFingerprint: string;
  appFingerprint: string;
}

/** Sent from C# to JS when calling a registered handler via reverse RPC. */
export interface ReverseRequest {
  id: string;
  contract: string;
  member: string;
  payload?: unknown;
}

/** Sent from JS back to C# with the handler result. */
export interface ReverseResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: BridgeError;
}

export type JsHandler<TPayload = unknown, TResult = unknown> = (
  payload: TPayload,
) => TResult | Promise<TResult>;
