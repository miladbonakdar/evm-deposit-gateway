#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [, , envFileArg = ".env", ...studioArgs] = process.argv;
const envPath = resolve(rootDir, envFileArg);
const drizzleKitBin = join(
  rootDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "drizzle-kit.cmd" : "drizzle-kit"
);

if (!existsSync(envPath)) {
  console.error(`Env file not found: ${envPath}`);
  process.exit(1);
}

if (!existsSync(drizzleKitBin)) {
  console.error("drizzle-kit is not installed. Run npm install first.");
  process.exit(1);
}

const env = {
  ...process.env,
  ...readEnvFile(envPath)
};

if (!env.DATABASE_URL) {
  console.error(`DATABASE_URL is missing in ${envPath}`);
  process.exit(1);
}

console.log(`Loaded ${envPath}`);
console.log("Starting Drizzle Studio for DB Studio");

const child = spawn(drizzleKitBin, ["studio", "--config", "drizzle.config.ts", ...studioArgs], {
  cwd: rootDir,
  env,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

function readEnvFile(filePath) {
  const parsed = {};
  const content = readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }

    parsed[match[1]] = parseEnvValue(match[2] ?? "");
  }

  return parsed;
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}
