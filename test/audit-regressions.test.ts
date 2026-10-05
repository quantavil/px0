import { beforeEach, expect, test } from "bun:test";
import app, { rateLimitMap } from "../src/index";
import { renderMarkdown } from "../src/server-renderer";

beforeEach(() => rateLimitMap.clear());
async function create(content: string, ttl = "1d") {
  const response = await app.request("/api/paste", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, ttl }),
  });
  return (await response.json()) as { id: string };
}

test("concurrent burn reveals return the content to only one reader", async () => {
  const { id } = await create("one reader secret", "burn");
  const responses = await Promise.all([
    app.request(`/${id}?confirm=1`),
    app.request(`/${id}?confirm=1`),
  ]);
  expect(responses.map((r) => r.status).sort()).toEqual([200, 404]);
});

test("storage prefixes are literal text in ordinary pastes", async () => {
  for (const content of [
    "__PX0_BURN__:normal text",
    "__PX0_ENC__:normal text",
  ]) {
    const { id } = await create(content);
    const response = await app.request(`/${id}`);
    const html = await response.text();
    expect(html).toContain(content);
    expect(html).not.toContain('data-encrypted="true"');
    expect(html).not.toContain("Reveal &amp; Self-Destruct");
    expect(html).not.toContain("Reveal & Self-Destruct");
  }
});

test("JSON escaping does not reduce the paste content limit", async () => {
  const content = "x\n".repeat(2_620_940);
  const body = JSON.stringify({ content, ttl: "1d" });
  const response = await app.request("/api/paste", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(body.length),
    },
    body,
  });
  expect(response.status).toBe(200);
});

test("large Markdown renders a bounded readable excerpt instead of an enormous DOM", () => {
  const html = renderMarkdown(
    "## Heading\n\n```js\nconst x = 42;\n```\n\n".repeat(30000),
  );
  expect(html).toContain("Large paste");
  expect(html.length).toBeLessThan(100000);
});

test("scripts can revalidate cached copies without caching private pastes", async () => {
  const first = await app.request("/static/landing.js");
  const etag = first.headers.get("etag");
  expect(etag).toBeTruthy();
  expect(first.headers.get("cache-control")).not.toContain("no-store");
  const second = await app.request("/static/landing.js", {
    headers: { "If-None-Match": etag ?? "" },
  });
  expect(second.status).toBe(304);
  const { id } = await create("private text");
  expect((await app.request(`/${id}`)).headers.get("cache-control")).toBe(
    "no-store",
  );
});
