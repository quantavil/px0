import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BASE_CSS,
  CSS_VARIABLES,
  LANDING_CSS,
  MARKDOWN_CSS,
  NOT_FOUND_CSS,
  VIEWER_CSS,
} from "../src/styles";

async function minifyCss(cssContent: string, name: string): Promise<string> {
  const buildResult = await Bun.build({
    entrypoints: [`virtual:${name}.css`],
    plugins: [
      {
        name: "virtual-css",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, (args) => ({
            path: args.path,
            namespace: "virtual",
          }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({
            contents: cssContent,
            loader: "css",
          }));
        },
      },
    ],
    minify: true,
  });

  if (!buildResult.success || !buildResult.outputs[0]) {
    throw new Error(`Failed to minify ${name}: ${buildResult.logs.join("\n")}`);
  }
  return await buildResult.outputs[0].text();
}

async function main() {
  const publicDir = join(import.meta.dir, "../public");
  mkdirSync(publicDir, { recursive: true });

  const landing = await minifyCss(
    CSS_VARIABLES + BASE_CSS + MARKDOWN_CSS + LANDING_CSS,
    "landing",
  );
  const viewer = await minifyCss(
    CSS_VARIABLES + BASE_CSS + MARKDOWN_CSS + VIEWER_CSS,
    "viewer",
  );
  const notFound = await minifyCss(
    CSS_VARIABLES + BASE_CSS + NOT_FOUND_CSS,
    "not-found",
  );

  writeFileSync(join(publicDir, "landing.min.css"), landing);
  writeFileSync(join(publicDir, "viewer.min.css"), viewer);
  writeFileSync(join(publicDir, "not-found.min.css"), notFound);

  console.log("CSS minification complete:");
  console.log(`  public/landing.min.css: ${landing.length} bytes`);
  console.log(`  public/viewer.min.css: ${viewer.length} bytes`);
  console.log(`  public/not-found.min.css: ${notFound.length} bytes`);
}

await main();
