import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Miniflare } from "miniflare";

const persistence = await mkdtemp(join(tmpdir(), "px0-worker-"));
const options = {
  resourcePersistencePath: persistence,
  workers: [
    {
      config: {
        name: "px0-integration",
        compatibilityDate: "2026-01-01",
        manifest: {
          mainModule: "index.js",
          modules: {
            "index.js": {
              type: "esm",
              contents: await readFile(
                resolve(".wrangler/test-worker/index.js"),
                "utf8",
              ),
            },
          },
        },
        env: {
          PASTE_STORE: {
            type: "durable-object",
            worker: "px0-integration",
            exportName: "PasteStore",
          },
          PASTES_KV: { type: "kv", id: "legacy-kv" },
        },
        exports: { PasteStore: { type: "durable-object", storage: "sqlite" } },
      },
    },
  ],
};
let worker = new Miniflare(options);
let checks = 0;
const request = (path, init) =>
  worker.dispatchFetch(`https://px0.test${path}`, init);
async function create(content, ttl = "1d", encrypted = false) {
  const response = await request("/api/paste", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, ttl, encrypted }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function check(name, fn) {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
}
try {
  await check(
    "concurrent HTML/raw burn reveals have exactly one winner",
    async () => {
      const { id } = await create("one-time secret", "burn");
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          request(`${i % 2 ? "/raw" : ""}/${id}?confirm=1`),
        ),
      );
      assert.equal(responses.filter((r) => r.status === 200).length, 1);
      assert.equal(responses.filter((r) => r.status === 404).length, 11);
    },
  );
  let deleted;
  await check(
    "delete token is enforced and deletion remains effective after restart",
    async () => {
      deleted = await create("persistent deletion");
      assert.equal(
        (
          await request(`/api/paste/${deleted.id}`, {
            method: "DELETE",
            headers: { "X-Delete-Token": "wrong" },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request(`/api/paste/${deleted.id}`, {
            method: "DELETE",
            headers: { "X-Delete-Token": deleted.deleteToken },
          })
        ).status,
        200,
      );
      await worker.dispose();
      worker = new Miniflare(options);
      assert.equal((await request(`/${deleted.id}`)).status, 404);
    },
  );
  await check(
    "maximum escaped content round-trips with bounded rendering",
    async () => {
      const content = "x\n".repeat(2621440);
      const { id } = await create(content);
      assert.equal(await (await request(`/raw/${id}`)).text(), content);
      const html = await (await request(`/${id}`)).text();
      assert.match(html, /Large paste/);
      // The raw JSON data intentionally contains the complete original for Copy.
      assert.ok(html.includes("px0-data"));
    },
  );
  await check(
    "legacy KV burn migrates once and cannot reappear from stale KV",
    async () => {
      const kv = await worker.getKVNamespace("PASTES_KV");
      await kv.put("legacyBurnFixture", "__PX0_BURN__:legacy secret", {
        metadata: {
          createdAt: Date.now(),
          ttlSeconds: 86400,
          deleteToken: "legacy-token",
        },
      });
      assert.equal((await request("/legacyBurnFixture")).status, 200);
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request("/legacyBurnFixture?confirm=1"),
        ),
      );
      assert.equal(responses.filter((r) => r.status === 200).length, 1);
      assert.equal((await request("/legacyBurnFixture?confirm=1")).status, 404);
      assert.match(await kv.get("legacyBurnFixture"), /legacy secret/);
    },
  );
  await check(
    "legacy encrypted links retain encryption and deletion credentials",
    async () => {
      const kv = await worker.getKVNamespace("PASTES_KV");
      await kv.put("legacyEncryptedFixture", "__PX0_ENC__:abc", {
        metadata: {
          createdAt: Date.now(),
          ttlSeconds: 86400,
          deleteToken: "old-token",
        },
      });
      assert.match(
        await (await request("/legacyEncryptedFixture")).text(),
        /data-encrypted="true"/,
      );
      assert.equal(
        (
          await request("/api/paste/legacyEncryptedFixture", {
            method: "DELETE",
            headers: { "X-Delete-Token": "old-token" },
          })
        ).status,
        200,
      );
      assert.equal((await request("/legacyEncryptedFixture")).status, 404);
    },
  );
  await check(
    "ordinary literal sentinels are never mode metadata",
    async () => {
      const content = "__PX0_BURN__:__PX0_ENC__:literal";
      const { id } = await create(content);
      assert.equal(await (await request(`/raw/${id}`)).text(), content);
      assert.match(
        await (await request(`/${id}`)).text(),
        /data-encrypted="false"/,
      );
    },
  );
  await check(
    "legacy expiry is enforced even if KV returns stale data",
    async () => {
      const kv = await worker.getKVNamespace("PASTES_KV");
      await kv.put("expiredFixture", "old text", {
        metadata: { createdAt: Date.now() - 7200000, ttlSeconds: 3600 },
      });
      assert.equal((await request("/expiredFixture")).status, 404);
    },
  );
  await check(
    "expiry alarm clears storage without breaking later requests",
    async () => {
      const namespace = await worker.getDurableObjectNamespace("PASTE_STORE");
      const stub = namespace.get(namespace.idFromName("alarmFixture"));
      const record = {
        value: "short lived",
        burn: false,
        encrypted: false,
        expiresAtMs: Date.now() + 200,
        deleteToken: "alarm-token",
      };
      assert.equal(
        (
          await stub.fetch("https://store/create?id=alarmFixture", {
            method: "POST",
            body: JSON.stringify(record),
          })
        ).status,
        201,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.equal((await request("/alarmFixture")).status, 404);
      assert.equal((await request("/alarmFixture")).status, 404);
    },
  );
  await check(
    "oversized streaming bodies without Content-Length are rejected",
    async () => {
      let remaining = 32 * 1024 * 1024;
      const body = new ReadableStream({
        pull(controller) {
          if (!remaining) {
            controller.close();
            return;
          }
          const n = Math.min(65536, remaining);
          remaining -= n;
          controller.enqueue(new Uint8Array(n).fill(120));
        },
      });
      const response = await request("/api/paste", {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body,
        duplex: "half",
      });
      assert.equal(response.status, 413);
    },
  );
  await check(
    "/api/image returns 404 as server image proxy is removed",
    async () => {
      const response = await request("/api/image", {
        method: "POST",
        headers: { "Content-Type": "image/png" },
        body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      });
      assert.equal(response.status, 404);
    },
  );
  await check(
    "/i/:file returns 404 as px0 does not host images directly",
    async () => {
      const response = await request("/i/nonexistent123.png");
      assert.equal(response.status, 404);
    },
  );
  console.log(`${checks} Worker integration checks passed`);
} finally {
  await worker.dispose();
  await rm(persistence, { recursive: true, force: true });
}
