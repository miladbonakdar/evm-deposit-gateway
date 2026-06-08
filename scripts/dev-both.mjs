#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(rootDir, process.argv[2] ?? ".env");
const tsxBin = join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");

if (!existsSync(envPath)) {
  console.error(`Env file not found: ${envPath}`);
  process.exit(1);
}

if (!existsSync(tsxBin)) {
  console.error("tsx is not installed. Run npm install first.");
  process.exit(1);
}

const env = {
  ...process.env,
  ...readEnvFile(envPath)
};

const children = [
  start("api", ["watch", "src/index.ts"]),
  start("worker", ["watch", "src/worker.ts"])
];
let stopping = false;

console.log(`Loaded ${envPath}`);
console.log("Starting API and worker with hot reload");

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopAll(signal, 0));
}

function start(name, args) {
  const child = spawn(tsxBin, args, {
    cwd: rootDir,
    env,
    stdio: ["inherit", "pipe", "pipe"]
  });

  prefixStream(name, child.stdout);
  prefixStream(name, child.stderr);

  child.on("exit", (code, signal) => {
    if (stopping) {
      return;
    }

    const reason = signal ? signal : `code ${code ?? 0}`;
    console.error(`[${name}] exited with ${reason}`);
    stopAll("SIGTERM", code ?? 1);
  });

  return child;
}

function stopAll(signal, exitCode) {
  if (stopping) {
    return;
  }

  stopping = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }

  const forceTimer = setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
  }, 5000);

  Promise.all(children.map(waitForExit))
    .finally(() => {
      clearTimeout(forceTimer);
      process.exit(exitCode);
    });
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  return new Promise((resolveExit) => child.once("exit", resolveExit));
}

function prefixStream(name, stream) {
  const lines = createInterface({ input: stream });
  lines.on("line", (line) => {
    console.log(`[${name}] ${line}`);
  });
}

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
