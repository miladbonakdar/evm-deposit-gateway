import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const merchantApiKeys = pgTable(
  "merchant_api_keys",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true })
  },
  (table) => ({
    publicKeyUnique: uniqueIndex("merchant_api_keys_public_key_unique").on(table.publicKey),
    merchantIdx: index("merchant_api_keys_merchant_idx").on(table.merchantId)
  })
);

export const requestNonces = pgTable(
  "request_nonces",
  {
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => merchantApiKeys.id, { onDelete: "cascade" }),
    nonce: text("nonce").notNull(),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.apiKeyId, table.nonce] })
  })
);

export const webhookConfigs = pgTable("webhook_configs", {
  merchantId: uuid("merchant_id")
    .primaryKey()
    .references(() => merchants.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const treasuryWallets = pgTable(
  "treasury_wallets",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    token: text("token").notNull(),
    address: text("address").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    merchantAssetUnique: uniqueIndex("treasury_wallets_merchant_asset_unique").on(
      table.merchantId,
      table.network,
      table.token
    )
  })
);

export const depositAddresses = pgTable(
  "deposit_addresses",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    token: text("token").notNull(),
    address: text("address").notNull(),
    privateKeyEncrypted: text("private_key_encrypted").notNull(),
    status: text("status").notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    externalId: text("external_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    addressAssetUnique: uniqueIndex("deposit_addresses_address_asset_unique").on(
      table.network,
      table.token,
      table.address
    ),
    merchantIdx: index("deposit_addresses_merchant_idx").on(table.merchantId),
    externalIdx: index("deposit_addresses_external_idx").on(table.merchantId, table.externalId)
  })
);

export const chainCursors = pgTable(
  "chain_cursors",
  {
    network: text("network").notNull(),
    token: text("token").notNull(),
    lastScannedBlock: bigint("last_scanned_block", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.network, table.token] })
  })
);

export const tokenTransfers = pgTable(
  "token_transfers",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    depositAddressId: uuid("deposit_address_id")
      .notNull()
      .references(() => depositAddresses.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    token: text("token").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    amountRaw: text("amount_raw").notNull(),
    amountFormatted: text("amount_formatted").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash"),
    confirmations: integer("confirmations").notNull().default(0),
    status: text("status").notNull().default("detected"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
  },
  (table) => ({
    chainLogUnique: uniqueIndex("token_transfers_chain_log_unique").on(table.network, table.txHash, table.logIndex),
    depositIdx: index("token_transfers_deposit_idx").on(table.depositAddressId),
    statusIdx: index("token_transfers_status_idx").on(table.status)
  })
);

export const gasTopUps = pgTable(
  "gas_top_ups",
  {
    id: uuid("id").primaryKey(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => tokenTransfers.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    depositAddressId: uuid("deposit_address_id")
      .notNull()
      .references(() => depositAddresses.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    txHash: text("tx_hash"),
    amountWei: text("amount_wei").notNull(),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
  },
  (table) => ({
    transferUnique: uniqueIndex("gas_top_ups_transfer_unique").on(table.transferId),
    statusIdx: index("gas_top_ups_status_idx").on(table.status)
  })
);

export const sweeps = pgTable(
  "sweeps",
  {
    id: uuid("id").primaryKey(),
    transferId: uuid("transfer_id")
      .notNull()
      .references(() => tokenTransfers.id, { onDelete: "cascade" }),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    depositAddressId: uuid("deposit_address_id")
      .notNull()
      .references(() => depositAddresses.id, { onDelete: "cascade" }),
    network: text("network").notNull(),
    token: text("token").notNull(),
    txHash: text("tx_hash"),
    amountRaw: text("amount_raw").notNull(),
    amountFormatted: text("amount_formatted").notNull(),
    toAddress: text("to_address").notNull(),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
  },
  (table) => ({
    transferUnique: uniqueIndex("sweeps_transfer_unique").on(table.transferId),
    statusIdx: index("sweeps_status_idx").on(table.status)
  })
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    url: text("url").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    responseStatus: integer("response_status"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    dueIdx: index("webhook_events_due_idx").on(table.status, table.nextAttemptAt),
    merchantIdx: index("webhook_events_merchant_idx").on(table.merchantId)
  })
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    routeKeyUnique: uniqueIndex("idempotency_keys_route_key_unique").on(table.merchantId, table.route, table.key)
  })
);
