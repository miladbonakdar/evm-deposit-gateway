import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client.js";
import { PostgresRepository } from "../src/repositories/postgres.js";
import { newId } from "../src/utils/id.js";

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL)("Postgres repository integration", () => {
  it("creates and fetches merchants against a migrated database", async () => {
    const { db, client } = createDb(process.env.INTEGRATION_DATABASE_URL as string);
    const repo = new PostgresRepository(db);
    const merchant = await repo.createMerchant({ id: newId(), name: `Integration ${Date.now()}` });

    await expect(repo.getMerchant(merchant.id)).resolves.toMatchObject({
      id: merchant.id,
      name: merchant.name,
      status: "active"
    });

    await client.end();
  });
});
