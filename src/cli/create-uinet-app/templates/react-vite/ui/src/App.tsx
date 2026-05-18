import { useEffect, useRef, useState } from "react";
import { app, appWindow, clipboard, notifications, uinet } from "@uinet/sdk";
import type { WindowInfo, WindowSupport } from "@uinet/sdk";

const describeWindow = (windowInfo: WindowInfo): string => {
  const title = windowInfo.title || "(untitled)";
  return `${title} • ${Math.round(windowInfo.width)}x${Math.round(windowInfo.height)} • ${windowInfo.state}`;
};

const formatError = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error);
};

const App = () => {
  const [info, setInfo] = useState("Press a button to call a native module.");
  const [windowSummary, setWindowSummary] = useState(
    "Window controls are ready. Click a button to inspect or update the native window.",
  );
  const [windowSupport, setWindowSupport] = useState<WindowSupport | null>(null);
  const [caps, setCaps] = useState<Record<string, string[]> | null>(null);
  const [count, setCount] = useState(0);
  const countRef = useRef(0);

  useEffect(() => {
    const unsubscribeCounter = uinet.handle<void, number>("counter.increment", () => {
      countRef.current += 1;
      setCount(countRef.current);
      return countRef.current;
    });

    const unsubscribeResized = appWindow.onResized((windowInfo) => {
      setWindowSummary(`Window resized: ${describeWindow(windowInfo)}`);
    });

    const unsubscribeStateChanged = appWindow.onStateChanged((windowInfo) => {
      setWindowSummary(`Window state changed: ${describeWindow(windowInfo)}`);
    });

    void appWindow
      .getSupport()
      .then((result: WindowSupport) => {
        setWindowSupport(result);
      })
      .catch(() => {
        setWindowSupport(null);
      });

    return () => {
      unsubscribeCounter();
      unsubscribeResized();
      unsubscribeStateChanged();
    };
  }, []);

  const handleGetAppInfo = async () => {
    try {
      const result = await app.getInfo();
      setInfo(`${result.appName} v${result.version} on ${result.platform}`);
    } catch (error: unknown) {
      setInfo(`Error: ${formatError(error)}`);
    }
  };

  const handleReadClipboard = async () => {
    try {
      const result = await clipboard.getText();
      setInfo(`Clipboard: ${result.text || "(empty)"}`);
    } catch (error: unknown) {
      setInfo(`Error: ${formatError(error)}`);
    }
  };

  const handleCapabilities = async () => {
    try {
      const result = await uinet.capabilities();
      setCaps(result);
    } catch (error: unknown) {
      setInfo(`Error: ${formatError(error)}`);
    }
  };

  const handleNotification = async () => {
    try {
      const permission = await notifications.requestPermission();
      if (!permission.granted) {
        setInfo(
          "Notifications are disabled. Enable them in your system settings and try again.",
        );
        return;
      }

      const result = await notifications.show({
        title: "{{appTitle}}",
        body: `Counter is ${countRef.current}. Sent from the native notifications module.`,
      });

      setInfo(
        result.scheduled
          ? "Notification sent."
          : "Notification could not be shown. Check your notification settings.",
      );
    } catch (error: unknown) {
      setInfo(`Error: ${formatError(error)}`);
    }
  };

  const handleGetWindowInfo = async () => {
    try {
      const result = await appWindow.getCurrent();
      setWindowSummary(`Current window: ${describeWindow(result)}`);
    } catch (error: unknown) {
      setWindowSummary(`Window error: ${formatError(error)}`);
    }
  };

  const handleRenameWindow = async () => {
    try {
      const result = await appWindow.setTitle({
        title: `{{appTitle}} (${countRef.current})`,
      });
      setWindowSummary(`Window renamed: ${describeWindow(result)}`);
    } catch (error: unknown) {
      setWindowSummary(`Window error: ${formatError(error)}`);
    }
  };

  const handleResizeWindow = async () => {
    try {
      const result = await appWindow.configure({
        width: 1100,
        height: 760,
      });
      setWindowSummary(`Window resized: ${describeWindow(result)}`);
    } catch (error: unknown) {
      setWindowSummary(`Window error: ${formatError(error)}`);
    }
  };

  const handleMaximizeWindow = async () => {
    try {
      const result = await appWindow.maximize();
      setWindowSummary(`Window maximized: ${describeWindow(result)}`);
    } catch (error: unknown) {
      setWindowSummary(`Window error: ${formatError(error)}`);
    }
  };

  const handleCenterWindow = async () => {
    try {
      const result = await appWindow.center();
      setWindowSummary(`Window centered: ${describeWindow(result)}`);
    } catch (error: unknown) {
      setWindowSummary(`Window error: ${formatError(error)}`);
    }
  };

  const handleMinimizeWindow = async () => {
    try {
      const result = await appWindow.minimize();
      setWindowSummary(`Window minimized: ${describeWindow(result)}`);
    } catch (error: unknown) {
      setWindowSummary(`Window error: ${formatError(error)}`);
    }
  };

  const handleRestoreWindow = async () => {
    try {
      const result = await appWindow.restore();
      setWindowSummary(`Window restored: ${describeWindow(result)}`);
    } catch (error: unknown) {
      setWindowSummary(`Window error: ${formatError(error)}`);
    }
  };

  const showsAdvancedWindowActions =
    !!windowSupport &&
    (windowSupport.center ||
      windowSupport.maximize ||
      windowSupport.minimize ||
      windowSupport.restore ||
      windowSupport.setFullscreen);

  return (
    <div className="container">
      <h1>{{appTitle}}</h1>
      <p className="subtitle">React + .NET MAUI</p>

      <div className="card">
        <p className="counter">
          Counter: <strong>{count}</strong>
          <span className="counter-hint">Incremented by .NET every 10s</span>
        </p>
      </div>

      <div className="card">
        <p className="result">{info}</p>

        <div className="actions">
          <button onClick={handleGetAppInfo}>Get App Info</button>
          <button onClick={handleReadClipboard}>Read Clipboard</button>
          <button onClick={handleNotification}>Send Notification</button>
          <button onClick={handleCapabilities}>List Capabilities</button>
        </div>

        {caps && (
          <pre className="capabilities">{JSON.stringify(caps, null, 2)}</pre>
        )}
      </div>

      <div className="card">
        <p className="window-summary">{windowSummary}</p>

        <div className="actions">
          <button onClick={handleGetWindowInfo}>Get Window Info</button>
          <button onClick={handleRenameWindow}>Rename Window</button>
          <button onClick={handleResizeWindow}>Resize Window</button>
          {windowSupport?.center && <button onClick={handleCenterWindow}>Center Window</button>}
          {windowSupport?.maximize && (
            <>
              <button onClick={handleMaximizeWindow}>Maximize Window</button>
              <button onClick={handleRestoreWindow}>Restore Window</button>
            </>
          )}
          {windowSupport?.minimize && (
            <button onClick={handleMinimizeWindow}>Minimize Window</button>
          )}
        </div>

        {!showsAdvancedWindowActions && windowSupport && (
          <p className="result">
            This runtime currently supports title and size updates only. Unsupported window actions
            are hidden automatically based on native support metadata.
          </p>
        )}
      </div>
    </div>
  );
};

export default App;
