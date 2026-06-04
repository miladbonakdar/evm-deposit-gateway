import { loadAppConfig } from "./config/env.js";
import { createDb } from "./db/client.js";
import { PostgresRepository } from "./repositories/postgres.js";
import { WebhookDeliveryService } from "./services/webhook-delivery.js";
import { DefaultWebhookService } from "./services/webhook-service.js";
import { DepositWorker } from "./worker/deposit-worker.js";
import { ViemEvmProvider } from "./worker/evm-provider.js";

const config = loadAppConfig();
const { db, client } = createDb(config.databaseUrl);
const repo = new PostgresRepository(db);
const webhooks = new DefaultWebhookService(repo, config.encryptor);
const worker = new DepositWorker({
  repo,
  networks: config.networks,
  encryptor: config.encryptor,
  evm: new ViemEvmProvider(),
  webhooks
});
const delivery = new WebhookDeliveryService(repo, config);

let stopped = false;

async function tick() {
  try {
    await worker.runOnce();
    await delivery.deliverDue();
  } catch (error) {
    console.error(error);
  }
}

async function loop() {
  console.log("Crypto Deposit worker started");
  while (!stopped) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, config.workerPollIntervalMs));
  }
}

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down`);
  stopped = true;
  await client.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void loop();
