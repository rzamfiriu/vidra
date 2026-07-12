import { createServer } from "node:net";
import prompts from "prompts";
import { isInteractive } from "./doctor.js";

const MIN_PORT = 1;
const MAX_PORT = 65_535;

export type PortAvailabilityProbe = (
  port: number,
  hostname: string,
) => Promise<boolean>;

interface PortQuestion {
  type: "number";
  name: "port";
  message: string;
  initial: number;
  validate: (value: number) => Promise<true | string>;
}

type PortPrompt = (question: PortQuestion) => Promise<{ port?: number }>;

export interface SelectDevServerUrlOptions {
  interactive?: boolean;
  isPortAvailable?: PortAvailabilityProbe;
  prompt?: PortPrompt;
}

export const isValidPort = (port: number): boolean =>
  Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;

/**
 * Checks whether a local TCP endpoint can be bound. The server is closed
 * immediately; Vite still owns the real bind when the dev session starts.
 */
export const isPortAvailable: PortAvailabilityProbe = (port, hostname) =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    });

    server.listen({ host: hostname, port, exclusive: true }, () => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(true);
      });
    });
  });

export const findNextAvailablePort = async (
  occupiedPort: number,
  hostname: string,
  probe: PortAvailabilityProbe = isPortAvailable,
): Promise<number> => {
  for (let port = occupiedPort + 1; port <= MAX_PORT; port++) {
    if (await probe(port, hostname)) return port;
  }
  throw new Error(`No available port found after ${occupiedPort}`);
};

const defaultPrompt: PortPrompt = async (question) => {
  const result = await prompts(question, { onCancel: () => false });
  return { port: result.port as number | undefined };
};

/**
 * Returns the configured URL unchanged when its port is free. If it is busy,
 * an interactive session asks for a replacement without persisting it.
 */
export const selectDevServerUrl = async (
  configuredUrl: string,
  options: SelectDevServerUrlOptions = {},
): Promise<string> => {
  const url = new URL(configuredUrl);
  const port = Number(url.port);
  if (!isValidPort(port)) {
    throw new Error(`Dev server URL must include a valid port: ${configuredUrl}`);
  }

  const probe = options.isPortAvailable ?? isPortAvailable;
  if (await probe(port, url.hostname)) return configuredUrl;

  const interactive = options.interactive ?? isInteractive();
  if (!interactive) {
    throw new Error(
      `Port ${port} is already in use and no interactive terminal is available`,
    );
  }

  const suggestedPort = await findNextAvailablePort(port, url.hostname, probe);
  const prompt = options.prompt ?? defaultPrompt;
  const result = await prompt({
    type: "number",
    name: "port",
    message: `Port ${port} is already in use. Choose another port:`,
    initial: suggestedPort,
    validate: async (value) => {
      if (!isValidPort(value)) {
        return `Enter a port between ${MIN_PORT} and ${MAX_PORT}`;
      }
      return (await probe(value, url.hostname)) || `Port ${value} is already in use`;
    },
  });

  const selectedPort = result.port;
  if (selectedPort === undefined) {
    throw new Error("Port selection cancelled");
  }
  if (!isValidPort(selectedPort) || !(await probe(selectedPort, url.hostname))) {
    throw new Error(`Port ${selectedPort} is not available`);
  }

  url.port = String(selectedPort);
  return url.toString();
};
