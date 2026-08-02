import app from "../src/index";

const port = Number(process.env.PORT) || 3000;

const server = Bun.serve({
  fetch: app.fetch,
  port,
});

console.log(`px0 dev server running on http://localhost:${server.port}`);
