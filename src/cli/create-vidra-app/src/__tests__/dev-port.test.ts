import { createServer, type AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  findNextAvailablePort,
  isPortAvailable,
  isValidPort,
  selectDevServerUrl,
} from "../dev-port.js";

const servers: ReturnType<typeof createServer>[] = [];

const occupyEphemeralPort = async (): Promise<{
  port: number;
  close: () => Promise<void>;
}> => {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, resolve);
  });
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          if (!server.listening) {
            resolve();
            return;
          }
          server.close(() => resolve());
        }),
    ),
  );
});

describe("isPortAvailable", () => {
  it("reports a bound port as unavailable", async () => {
    const occupied = await occupyEphemeralPort();
    await expect(isPortAvailable(occupied.port, "127.0.0.1")).resolves.toBe(false);
  });

  it("reports a released port as available", async () => {
    const occupied = await occupyEphemeralPort();
    await occupied.close();
    await expect(isPortAvailable(occupied.port, "127.0.0.1")).resolves.toBe(true);
  });
});

describe("findNextAvailablePort", () => {
  it("returns the first available port after the occupied one", async () => {
    const probe = vi.fn(async (port: number) => port === 5175);

    await expect(findNextAvailablePort(5173, "localhost", probe)).resolves.toBe(
      5175,
    );
    expect(probe.mock.calls.map(([port]) => port)).toEqual([5174, 5175]);
  });
});

describe("selectDevServerUrl", () => {
  it("leaves the configured URL unchanged when its port is free", async () => {
    const probe = vi.fn(async () => true);

    await expect(
      selectDevServerUrl("http://localhost:5173", {
        interactive: true,
        isPortAvailable: probe,
      }),
    ).resolves.toBe("http://localhost:5173");
  });

  it("prompts for an available replacement port", async () => {
    const availability = new Map([
      [5173, false],
      [5174, true],
      [6000, true],
    ]);
    const probe = vi.fn(
      async (port: number) => availability.get(port) ?? false,
    );

    const selectedUrl = await selectDevServerUrl("http://localhost:5173", {
      interactive: true,
      isPortAvailable: probe,
      prompt: async (question) => {
        expect(question.message).toContain("Port 5173 is already in use");
        expect(question.initial).toBe(5174);
        await expect(question.validate(70_000)).resolves.toContain(
          "between 1 and 65535",
        );
        await expect(question.validate(5173)).resolves.toBe(
          "Port 5173 is already in use",
        );
        await expect(question.validate(6000)).resolves.toBe(true);
        return { port: 6000 };
      },
    });

    expect(selectedUrl).toBe("http://localhost:6000/");
  });

  it("fails clearly when the session cannot prompt", async () => {
    await expect(
      selectDevServerUrl("http://localhost:5173", {
        interactive: false,
        isPortAvailable: async () => false,
      }),
    ).rejects.toThrow(
      "Port 5173 is already in use and no interactive terminal is available",
    );
  });

  it("fails clearly when port selection is cancelled", async () => {
    const probe = vi.fn(async (port: number) => port === 5174);

    await expect(
      selectDevServerUrl("http://localhost:5173", {
        interactive: true,
        isPortAvailable: probe,
        prompt: async () => ({}),
      }),
    ).rejects.toThrow("Port selection cancelled");
  });

  it("rejects a configured URL without an explicit valid port", async () => {
    await expect(
      selectDevServerUrl("http://localhost", {
        interactive: true,
        isPortAvailable: async () => true,
      }),
    ).rejects.toThrow("Dev server URL must include a valid port");
  });
});

describe("isValidPort", () => {
  it.each([1, 5173, 65_535])("accepts %s", (port) => {
    expect(isValidPort(port)).toBe(true);
  });

  it.each([0, -1, 1.5, 65_536, Number.NaN])("rejects %s", (port) => {
    expect(isValidPort(port)).toBe(false);
  });
});
