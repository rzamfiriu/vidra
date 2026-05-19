import { execSync } from "node:child_process";
import chalk from "chalk";

export const exec = (cmd: string, cwd: string): void => {
  try {
    execSync(cmd, { cwd, stdio: "pipe" });
  } catch (e: unknown) {
    const err = e as { stderr?: Buffer; message: string };
    console.error(chalk.red(`  Command failed: ${cmd}`));
    console.error(chalk.dim(err.stderr?.toString() || err.message));
    process.exit(1);
  }
};

export const tryExec = (cmd: string, cwd: string): boolean => {
  try {
    execSync(cmd, { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};
