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
import { sql } from "drizzle-orm";

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

export const notificationPreferences = pgTable("notification_preferences", {
  merchantId: uuid("merchant_id")
    .primaryKey()
    .references(() => merchants.id, { onDelete: "cascade" }),
  enabledEvents: jsonb("enabled_events").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});

export const operationalWallets = pgTable(
  "operational_wallets",
  {
    id: uuid("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    network: text("network").notNull(),
    token: text("token"),
    address: text("address").notNull(),
    privateKeyEncrypted: text("private_key_encrypted").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    scopeUnique: uniqueIndex("operational_wallets_scope_unique").on(table.scopeKey),
    merchantIdx: index("operational_wallets_merchant_idx").on(table.merchantId),
    networkIdx: index("operational_wallets_network_idx").on(table.network)
  })
);

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
    label: text("label").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    operationalWalletId: uuid("operational_wallet_id").references(() => operationalWallets.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
  },
  (table) => ({
    merchantAssetAddressUnique: uniqueIndex("treasury_wallets_merchant_asset_address_unique").on(
      table.merchantId,
      table.network,
      table.token,
      table.address
    ),
    defaultUnique: uniqueIndex("treasury_wallets_default_unique")
      .on(table.merchantId, table.network, table.token)
      .where(sql`${table.isDefault} = true`)
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
    treasuryWalletId: uuid("treasury_wallet_id").references(() => treasuryWallets.id, { onDelete: "set null" }),
    callbackUrl: text("callback_url"),
    callbackSecretEncrypted: text("callback_secret_encrypted"),
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
    settlementStatus: text("settlement_status").notNull().default("pending"),
    settlementStep: text("settlement_step"),
    settlementFailureReason: text("settlement_failure_reason"),
    settlementUpdatedAt: timestamp("settlement_updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
  },
  (table) => ({
    transferAttemptUnique: uniqueIndex("gas_top_ups_transfer_attempt_unique").on(table.transferId, table.attemptNumber),
    transferIdx: index("gas_top_ups_transfer_idx").on(table.transferId),
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
    attemptNumber: integer("attempt_number").notNull().default(1),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
  },
  (table) => ({
    transferAttemptUnique: uniqueIndex("sweeps_transfer_attempt_unique").on(table.transferId, table.attemptNumber),
    transferIdx: index("sweeps_transfer_idx").on(table.transferId),
    statusIdx: index("sweeps_status_idx").on(table.status)
  })
);

export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id").references(() => merchants.id, { onDelete: "set null" }),
    sourceWalletId: uuid("source_wallet_id")
      .notNull()
      .references(() => operationalWallets.id, { onDelete: "restrict" }),
    network: text("network").notNull(),
    token: text("token"),
    asset: text("asset").notNull(),
    txHash: text("tx_hash"),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    amountRaw: text("amount_raw").notNull(),
    amountFormatted: text("amount_formatted").notNull(),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true })
  },
  (table) => ({
    sourceIdx: index("wallet_transactions_source_idx").on(table.sourceWalletId),
    statusIdx: index("wallet_transactions_status_idx").on(table.status),
    networkIdx: index("wallet_transactions_network_idx").on(table.network)
  })
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey(),
    merchantId: uuid("merchant_id")
      .notNull()
      .references(() => merchants.id, { onDelete: "cascade" }),
    depositAddressId: uuid("deposit_address_id").references(() => depositAddresses.id, { onDelete: "set null" }),
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
    merchantIdx: index("webhook_events_merchant_idx").on(table.merchantId),
    depositAddressIdx: index("webhook_events_deposit_address_idx").on(table.depositAddressId)
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
