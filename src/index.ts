import { serve } from "@hono/node-server";
import { createApp } from "./api/app.js";
import { loadAppConfig } from "./config/env.js";
import { createDb } from "./db/client.js";
import { PostgresRepository } from "./repositories/postgres.js";

const config = loadAppConfig();
const { db, client } = createDb(config.databaseUrl);
const repo = new PostgresRepository(db);
const app = createApp({ repo, config });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Crypto Deposit API listening on http://localhost:${info.port}`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down`);
  server.close();
  await client.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
