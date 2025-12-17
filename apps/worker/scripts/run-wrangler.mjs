import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function workerDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function resolveWranglerConfigPath(dir) {
  const explicit = process.env.CLOVERBINGO_WRANGLER_CONFIG?.trim();
  if (explicit) return explicit;

  const local = path.join(dir, "wrangler.local.toml");
  if (fs.existsSync(local)) return local;
  return null;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    process.stderr.write("usage: node scripts/run-wrangler.mjs <wrangler args...>\n");
    process.exit(2);
  }

  const dir = workerDir();
  const configPath = resolveWranglerConfigPath(dir);
  const configArgs = configPath ? ["--config", configPath] : [];

  const result = spawnSync("wrangler", [...configArgs, ...args], {
    cwd: dir,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

main();
