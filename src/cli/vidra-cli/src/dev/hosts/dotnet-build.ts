import path from "node:path";
import { execFileSync } from "node:child_process";
import fs from "fs-extra";
import { formatBuildError } from "@vidra-dev/cli-shared/exec";
import { dim, taggedRow, value } from "@vidra-dev/cli-shared/theme";
import { HostLaunchError, type HostContext } from "./host.js";

export const DOTNET_COMMAND = process.platform === "win32" ? "dotnet.exe" : "dotnet";

/**
 * `dotnet build -c <config> -f <framework> <extraArgs> <csproj>`, as a
 * discrete step, never MSBuild's `-t:Run`: that target shells out to `open -a`
 * on macOS, which fails on locally signed apps, and on Windows execs an
 * unpackaged app before its native deps are laid out. Both surface only as a
 * bare `MSB3073 ... exited with code N`.
 */
export const dotnetBuild = (
  ctx: HostContext,
  extraArgs: readonly string[],
  failureMessage: string,
): void => {
  try {
    execFileSync(
      DOTNET_COMMAND,
      [
        "build",
        "-c",
        ctx.buildConfig,
        "-f",
        ctx.target.framework,
        ...extraArgs,
        ctx.project.csprojPath,
      ],
      { cwd: ctx.project.root, stdio: ctx.verbose ? "inherit" : "pipe" },
    );
  } catch (error) {
    throw new HostLaunchError(failureMessage, {
      output: formatBuildError(error),
      hint: ctx.verbose ? undefined : "re-run with --verbose for the full build log.",
    });
  }
};

/** Builds the host for the session's framework (and runtime identifier, on iOS). */
export const buildHost = (ctx: HostContext): void => {
  console.log(
    taggedRow(
      "active",
      "host",
      `${dim("building")} ${value(ctx.target.framework)} ${dim("…")}`,
    ),
  );
  const runtimeArgs = ctx.runtimeIdentifier ? ["-r", ctx.runtimeIdentifier] : [];
  dotnetBuild(ctx, runtimeArgs, "MAUI build failed");
};

/** Where `dotnet build` (and `dotnet watch build`) put the host. */
export const hostOutputDir = (ctx: HostContext): string =>
  path.join(
    ctx.project.hostDir,
    "bin",
    ctx.buildConfig,
    ctx.target.framework,
    ...(ctx.runtimeIdentifier ? [ctx.runtimeIdentifier] : []),
  );

export const requireApplicationId = (csprojPath: string): string => {
  const project = fs.readFileSync(csprojPath, "utf8");
  const applicationId = project.match(/<ApplicationId>([^<]+)<\/ApplicationId>/)?.[1]?.trim();
  if (!applicationId) {
    throw new HostLaunchError(`no <ApplicationId> found in ${csprojPath}`);
  }
  return applicationId;
};
