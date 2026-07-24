#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: true });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["tsc", "-b", "--pretty", "false"]);
run("npm", ["test"]);
run("npm", ["run", "build"]);
console.log("\n[check] all green");
