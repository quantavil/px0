import { BURN_PREFIX, ENC_PREFIX } from "./utils";

export type PasteRecord = {
  value: string;
  expiresAtMs?: number;
  deleteToken?: string;
  burn: boolean;
  encrypted: boolean;
  retired?: boolean;
};

type StoreEnv = { PASTES_KV?: KVNamespace };

// Legacy prefixes are interpreted only while migrating old KV records.
export function legacyRecord(
  value: string,
  metadata?: {
    createdAt?: number;
    ttlSeconds?: number;
    deleteToken?: string;
  } | null,
): PasteRecord {
  const burn = value.startsWith(BURN_PREFIX);
  if (burn) value = value.slice(BURN_PREFIX.length);
  return {
    value,
    burn,
    encrypted: value.startsWith(ENC_PREFIX),
    retired: value.startsWith("__PX0_PASS__:"),
    expiresAtMs:
      metadata?.createdAt && metadata.ttlSeconds
        ? metadata.createdAt + metadata.ttlSeconds * 1000
        : undefined,
    deleteToken: metadata?.deleteToken,
  };
}

// One SQLite-backed object per ID serializes creation, reveal and deletion.
// Payload chunks stay well below SQLite's row/string size limit.
export class PasteStore {
  private initialized = false;
  constructor(
    private ctx: DurableObjectState,
    private env: StoreEnv,
  ) {
    this.initialize();
  }

  private initialize() {
    if (this.initialized) return;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT)",
    );
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS chunks (position INTEGER PRIMARY KEY, value TEXT NOT NULL)",
    );
    this.initialized = true;
  }

  private read(): PasteRecord | null | undefined {
    const row = this.ctx.storage.sql
      .exec<{ metadata: string | null }>(
        "SELECT metadata FROM state WHERE id=1",
      )
      .toArray()[0];
    if (!row) return undefined;
    if (!row.metadata) return null;
    const meta = JSON.parse(row.metadata) as Omit<PasteRecord, "value">;
    if (meta.expiresAtMs && meta.expiresAtMs <= Date.now()) {
      this.remove();
      return null;
    }
    const value = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM chunks ORDER BY position")
      .toArray()
      .map((row) => row.value)
      .join("");
    return { ...meta, value };
  }

  private write(record: PasteRecord) {
    const { value, ...meta } = record;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO state VALUES (1, ?)",
        JSON.stringify(meta),
      );
      this.ctx.storage.sql.exec("DELETE FROM chunks");
      for (let offset = 0; offset < value.length; offset += 32768) {
        this.ctx.storage.sql.exec(
          "INSERT INTO chunks VALUES (?, ?)",
          offset,
          value.slice(offset, offset + 32768),
        );
      }
    });
  }

  private remove() {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM chunks");
      // A tombstone prevents stale legacy KV values from resurrecting a paste.
      this.ctx.storage.sql.exec(
        "INSERT OR REPLACE INTO state VALUES (1, NULL)",
      );
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const incoming =
      url.pathname === "/create"
        ? ((await request.json()) as PasteRecord)
        : undefined;
    return this.ctx.blockConcurrencyWhile(async () => {
      this.initialize();
      let record = this.read();
      if (record === undefined && this.env.PASTES_KV) {
        const id = url.searchParams.get("id") ?? "";
        const old = await this.env.PASTES_KV.getWithMetadata<{
          createdAt?: number;
          ttlSeconds?: number;
          deleteToken?: string;
        }>(id, { type: "text" });
        if (old.value !== null) {
          record = legacyRecord(old.value, old.metadata);
          if (!record.expiresAtMs) {
            const list = await this.env.PASTES_KV.list({
              prefix: id,
              limit: 1,
            });
            const key = list.keys.find((key) => key.name === id);
            record.expiresAtMs = key?.expiration
              ? key.expiration * 1000
              : undefined;
          }
          this.write(record);
          // Cleanup also bounds legacy tombstone retention; old KV TTLs are <=30d.
          await this.ctx.storage.setAlarm(
            record.expiresAtMs ?? Date.now() + 31 * 86400000,
          );
          record = this.read();
        }
      }
      if (url.pathname === "/create") {
        if (record !== undefined) return new Response(null, { status: 409 });
        if (!incoming?.expiresAtMs) return new Response(null, { status: 400 });
        this.write(incoming);
        await this.ctx.storage.setAlarm(incoming.expiresAtMs);
        return new Response(null, { status: 201 });
      }
      if (!record) return new Response(null, { status: 404 });
      if (url.pathname === "/delete") {
        if (
          !record.deleteToken ||
          request.headers.get("x-delete-token") !== record.deleteToken
        ) {
          return new Response(null, { status: 401 });
        }
        this.remove();
        return Response.json({ ok: true });
      }
      if (url.pathname === "/consume") {
        if (!record.burn) return new Response(null, { status: 409 });
        this.remove();
      }
      return Response.json(record);
    });
  }

  async alarm() {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.initialized = false;
  }
}
