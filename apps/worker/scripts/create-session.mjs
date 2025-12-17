import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

function workerDir() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function origin() {
  return process.env.CLOVERBINGO_ORIGIN || "http://localhost:5173";
}

function buildUrls(code, adminToken, modToken) {
  const base = origin();
  return {
    join: new URL(`/s/${code}`, base).toString(),
    displayTen: new URL(`/s/${code}/display/ten`, base).toString(),
    displayOne: new URL(`/s/${code}/display/one`, base).toString(),
    adminInvite: new URL(`/i/${adminToken}`, base).toString(),
    modInvite: new URL(`/i/${modToken}`, base).toString(),
    admin: new URL(`/s/${code}/admin?token=${adminToken}`, base).toString(),
    mod: new URL(`/s/${code}/mod?token=${modToken}`, base).toString(),
    compatAdmin: new URL(`/admin/${code}?token=${adminToken}`, base).toString(),
    compatMod: new URL(`/mod/${code}?token=${modToken}`, base).toString(),
  };
}

function runWrangler(args) {
  const explicitConfig = process.env.CLOVERBINGO_WRANGLER_CONFIG?.trim();
  const localConfig = path.resolve(workerDir(), "wrangler.local.toml");
  const configPath = explicitConfig ? path.resolve(workerDir(), explicitConfig) : fs.existsSync(localConfig) ? localConfig : null;
  const configArgs = configPath ? ["--config", configPath] : [];
  return execFileSync("wrangler", [...configArgs, ...args], {
    cwd: workerDir(),
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
}

function tryCreateOnce(mode) {
  const sessionId = crypto.randomUUID();
  const code = crypto.randomUUID().slice(0, 6).toUpperCase();
  const adminToken = crypto.randomUUID();
  const modToken = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const sql = [
    `INSERT INTO sessions (id, code, status, created_at, ended_at) VALUES ('${sessionId}', '${code}', 'active', '${createdAt}', NULL)`,
    `INSERT INTO invites (token, session_id, role, created_at, label) VALUES ('${adminToken}', '${sessionId}', 'admin', '${createdAt}', 'admin')`,
    `INSERT INTO invites (token, session_id, role, created_at, label) VALUES ('${modToken}', '${sessionId}', 'mod', '${createdAt}', 'mod')`,
  ].join(";\n");

  const baseArgs = ["d1", "execute", "DB", "--command", sql, "--yes"];
  const modeArgs = mode === "remote" ? ["--remote"] : ["--local", "--persist-to", ".wrangler/state"];
  runWrangler([...baseArgs, ...modeArgs]);

  return { sessionId, code, adminToken, modToken, createdAt };
}

function main() {
  const args = process.argv.slice(2);
  const mode = args.includes("--remote") ? "remote" : "local";

  let lastError = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const created = tryCreateOnce(mode);
      const urls = buildUrls(created.code, created.adminToken, created.modToken);
      process.stdout.write(
        [
          `ok: true`,
          `sessionId: ${created.sessionId}`,
          `sessionCode: ${created.code}`,
          ``,
          `participant: ${urls.join}`,
          `displayTen:  ${urls.displayTen}`,
          `displayOne:  ${urls.displayOne}`,
          `adminInvite: ${urls.adminInvite}`,
          `modInvite:   ${urls.modInvite}`,
          ``,
          `(compat) admin: ${urls.compatAdmin}`,
          `(compat) mod:   ${urls.compatMod}`,
          ``,
        ].join("\n"),
      );
      return;
    } catch (err) {
      lastError = err;
    }
  }

  process.stderr.write(`failed to create session after retries\n`);
  if (lastError) process.stderr.write(String(lastError) + "\n");
  process.exit(1);
}

main();
