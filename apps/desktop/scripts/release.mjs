#!/usr/bin/env node
/**
 * Local release gate for Shell Workbench.
 * Usage: node scripts/release.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`\n[release] failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
console.log(`[release] shell-workbench@${pkg.version}`);
console.log("[release] running check pipeline…");

run("npx", ["tsc", "-b", "--pretty", "false"]);
run("npm", ["test"]);
run("npm", ["run", "build"]);

console.log("\n[release] OK — frontend gate passed.");
console.log("[release] Desktop package: npm run tauri:build");
console.log("[release] See docs/RELEASE.md for signing notes.");
