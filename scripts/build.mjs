import { cp, mkdir, rm } from "node:fs/promises";

const outputDirectory = new URL("../dist/", import.meta.url);
const publicFiles = ["index.html", "app.css", "app.js", "og-image.png", "ramen.jpg"];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const file of publicFiles) {
  await cp(new URL(`../${file}`, import.meta.url), new URL(file, outputDirectory));
}

await cp(new URL("../public/_headers", import.meta.url), new URL("_headers", outputDirectory));

