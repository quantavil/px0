import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";

const source = readFileSync(
  new URL("../public/viewer.js", import.meta.url),
  "utf8",
);

// Execute the shipped bundle with real Web Crypto. Only the unavailable browser
// DOM and the failed module network request are replaced in this socket-free test.
async function runViewer(rawContent, hash = "") {
  const imports = [];
  let finish;
  const rendered = new Promise((resolve) => {
    finish = resolve;
  });
  const output = {
    innerHTML: "",
    children: [],
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild(el) {
      this.children.push(el);
      finish();
    },
  };
  const actions = { style: {} };
  const document = {
    readyState: "complete",
    getElementById(id) {
      return id === "output" ? output : id === "pasteActions" ? actions : null;
    },
    createElement(tag) {
      return {
        tag,
        children: [],
        textContent: "",
        appendChild(child) {
          this.children.push(child);
        },
      };
    },
  };
  const window = {
    __PX0_DATA__: { rawContent, isEncrypted: true },
    location: { pathname: "/fixture", hash },
    addEventListener() {},
  };
  vm.runInNewContext(
    source,
    {
      window,
      document,
      crypto: webcrypto,
      TextDecoder,
      Uint8Array,
      atob,
      matchMedia: () => ({ matches: false }),
      console: { error() {} },
    },
    {
      importModuleDynamically(specifier) {
        imports.push(specifier);
        return Promise.reject(new Error("Simulated preview network failure"));
      },
    },
  );
  await setImmediate();
  return { imports, output, actions, window, rendered };
}

test("an encrypted paste without a key does not request preview code", async () => {
  const result = await runViewer("__PX0_ENC__:abc");
  assert.match(result.output.innerHTML, /Decryption Key Required/);
  assert.deepEqual(result.imports, []);
});

test("an invalid decryption key does not request preview code", async () => {
  const result = await runViewer("__PX0_ENC__:abc", "#invalid");
  // Invalid raw key length rejects before any rendering/network operation.
  await setImmediate();
  assert.match(result.output.innerHTML, /Decryption Failed/);
  assert.deepEqual(result.imports, []);
});

test("preview network failure bounds displayed text and retains full decrypted content", {
  timeout: 5000,
}, async () => {
  const text = `<script>unsafe()</script>\n${"x".repeat(100000)}`;
  const key = await webcrypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text),
  );
  const payload = `__PX0_ENC__:${Buffer.concat([iv, Buffer.from(ciphertext)]).toString("base64url")}`;
  const hash = `#${Buffer.from(await webcrypto.subtle.exportKey("raw", key)).toString("base64url")}`;
  const result = await runViewer(payload, hash);
  await result.rendered;
  const pre = result.output.children.find((el) => el.tag === "pre");
  assert.ok(pre, "fallback contains preformatted text");
  assert.equal(pre.children[0].textContent.length, 20000);
  assert.equal(pre.children[0].textContent, text.slice(0, 20000));
  assert.ok(
    result.output.children.some(
      (el) => el.tag === "p" && /Large paste/.test(el.textContent),
    ),
  );
  assert.equal(result.window.__PX0_DECRYPTED_TEXT__, text);
  assert.equal(result.actions.style.display, "flex");
  assert.deepEqual(result.imports, ["/static/preview.js"]);
});
