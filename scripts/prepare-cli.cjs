#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const cliPath = path.join(__dirname, "..", "dist", "cli.js");
if (!fs.existsSync(cliPath)) {
  console.error(`prepare-cli: ${cliPath} not found — did tsc run first?`);
  process.exit(1);
}

const SHEBANG = "#!/usr/bin/env node\n";
const current = fs.readFileSync(cliPath, "utf8");

if (!current.startsWith("#!")) {
  fs.writeFileSync(cliPath, SHEBANG + current, "utf8");
}

fs.chmodSync(cliPath, 0o755);
console.log(`prepare-cli: shebang ensured + chmod 755 on ${path.relative(process.cwd(), cliPath)}`);
