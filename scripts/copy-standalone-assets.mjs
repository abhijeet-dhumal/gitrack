import { cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const standalone = path.resolve(".next/standalone");

for (const [source, destination] of [
  [".next/static", path.join(standalone, ".next/static")],
  ["public", path.join(standalone, "public")],
]) {
  if (!existsSync(source)) continue;
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}
