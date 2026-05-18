export interface BridgeRequest {
  id: string;
  module: string;
  method: string;
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
  event: string;
  data?: T;
}

export type EventHandler<T = unknown> = (data: T) => void;

export type Capabilities = Record<string, string[]>;

/** Sent from C# to JS when calling a registered handler via reverse RPC. */
export interface ReverseRequest {
  id: string;
  handler: string;
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
