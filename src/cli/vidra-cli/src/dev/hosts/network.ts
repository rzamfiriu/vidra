import os from "node:os";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1"];

/** This machine's first external IPv4 address, if it has one. */
export const localNetworkAddress = (): string | undefined =>
  Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .find((address) => address.family === "IPv4" && !address.internal)?.address;

/**
 * The host a device should use to reach the dev server: an explicit override,
 * else the dev URL's own host unless it only means "this machine", else the
 * LAN address.
 */
export const resolveDeviceDevHost = (
  devUrl: string,
  override?: string,
  detectedLanAddress?: string,
): string | undefined => {
  const explicit = override?.trim();
  if (explicit) return explicit;

  const configured = new URL(devUrl).hostname;
  return LOOPBACK_HOSTS.includes(configured) ? detectedLanAddress : configured;
};
