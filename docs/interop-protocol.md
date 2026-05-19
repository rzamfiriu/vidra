# Interop Protocol

## Transport

JS sends messages to C# via a hidden iframe navigating to `vidra://bridge?payload=<url-encoded-json>`. The MAUI `WebView.Navigating` handler intercepts this, cancels the navigation, and dispatches the request.

C# sends responses and events back via `WebView.EvaluateJavaScriptAsync`, calling global functions on the `window` object:

- `window.__vidra_callback(response)` for request responses
- `window.__vidra_onevent(event)` for pushed events

## Request Envelope

| Field     | Type    | Required | Description                         |
|-----------|---------|----------|-------------------------------------|
| `id`      | string  | yes      | Unique correlation ID               |
| `module`  | string  | yes      | Target module name                  |
| `method`  | string  | yes      | Method to invoke on the module      |
| `payload` | object  | no       | Arguments for the method            |

## Response Envelope

| Field     | Type    | Required | Description                         |
|-----------|---------|----------|-------------------------------------|
| `id`      | string  | yes      | Matching request correlation ID     |
| `success` | boolean | yes      | Whether the call succeeded          |
| `data`    | any     | no       | Return value on success             |
| `error`   | object  | no       | `{ code, message }` on failure      |

## Error Codes

| Code               | Meaning                                        |
|--------------------|-------------------------------------------------|
| `PARSE_ERROR`      | The JSON envelope could not be deserialized     |
| `MODULE_NOT_FOUND` | No module registered with the requested name    |
| `MODULE_ERROR`     | The module threw an exception during handling   |

## Event Envelope

| Field   | Type   | Required | Description                  |
|---------|--------|----------|------------------------------|
| `event` | string | yes      | Dot-separated event name     |
| `data`  | any    | no       | Event payload                |
