# Plan 10 — npm Publish-Ready Packaging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Make the package installable via `npm install -g` and runnable via `npx` without any further code changes. Stop short of actually running `npm publish` (that requires the user's npm auth).

**Architecture:** Update `package.json` to switch from a private project to a publishable scoped package. Add a tiny post-build script that prepends `#!/usr/bin/env node` to `dist/cli.js` and `chmod +x` it. Verify locally with `npm pack` and a clean-tmpdir install test. Update README with install/npx instructions and a "no telemetry" stance.

**Tech Stack:** Same as before. No runtime deps changes.

**Scope exclusions:**
- Actually running `npm publish` — requires npm login + 2FA, must be done by the user.
- Telemetry / install tracking — explicitly out of scope; the README will state "no telemetry" as a feature.
- GitHub release automation — could come later as a separate plan if useful.
- Renaming the GitHub repo — out of scope.

---

## File Structure

Modified:
- `package.json` — name (scoped), version, remove `private`, add `bin`/`main`/`exports`/`files`/`engines`, repo/bugs/homepage URLs, `prepublishOnly`.
- `README.md` — add install via npm + no-telemetry note.

New:
- `scripts/prepare-cli.cjs` — small build helper to prepend shebang + chmod the CLI binary. Uses `.cjs` so it works regardless of `"type": "module"`.

No changes to `src/`, `tests/`, or any analyzer logic.

---

## Task 1: package.json + shebang plumbing

**Files:**
- Modify: `package.json`
- Create: `scripts/prepare-cli.cjs`

- [ ] **Step 1: Inspect current package.json**

Run: `cat package.json` and confirm what's there. Current state per the plan controller:

```json
{
  "name": "seo-analysis",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "A crawl-based SEO analysis CLI for auditing websites.",
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/cli.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": { ... },
  "devDependencies": { ... }
}
```

If the actual content has drifted, adapt — preserve all existing fields, just add/change what's specified below.

- [ ] **Step 2: Update package.json**

Apply these changes:

1. Change `"name": "seo-analysis"` → `"name": "@davo20019/seo-audit"`.
2. Change `"version": "0.1.0"` → `"version": "0.2.0"`.
3. Remove `"private": true`.
4. Update `"description"` to reflect current capabilities. Use:
   ```
   "description": "Crawl-based SEO audit CLI with JS rendering, JSON-LD validation, CrUX field data, sitemap walking, HTML/PDF reports, and crawl diffing."
   ```
5. Add these new fields between `"description"` and `"scripts"`:
   ```json
   "license": "MIT",
   "author": "David Loor",
   "homepage": "https://github.com/davo20019/seo-analysis#readme",
   "repository": { "type": "git", "url": "git+https://github.com/davo20019/seo-analysis.git" },
   "bugs": { "url": "https://github.com/davo20019/seo-analysis/issues" },
   "keywords": [
     "seo", "audit", "crawler", "lighthouse", "schema", "json-ld",
     "core-web-vitals", "crux", "sitemap", "playwright", "headless",
     "cli", "open-source"
   ],
   "main": "./dist/index.js",
   "types": "./dist/index.d.ts",
   "exports": {
     ".": {
       "types": "./dist/index.d.ts",
       "default": "./dist/index.js"
     }
   },
   "bin": { "seo-audit": "./dist/cli.js" },
   "files": ["dist", "README.md", "LICENSE"],
   "engines": { "node": ">=20" },
   ```
6. Update the `"build"` script to also run the shebang/chmod helper:
   ```json
   "build": "tsc -p tsconfig.json && node scripts/prepare-cli.cjs",
   ```
7. Add a `"prepublishOnly"` script that gates publish on tests + build:
   ```json
   "prepublishOnly": "npm test && npm run build",
   ```

Final scripts block should be:

```json
"scripts": {
  "dev": "tsx src/cli.ts",
  "build": "tsc -p tsconfig.json && node scripts/prepare-cli.cjs",
  "start": "node dist/cli.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "prepublishOnly": "npm test && npm run build"
}
```

- [ ] **Step 3: Create scripts/prepare-cli.cjs**

Create `scripts/prepare-cli.cjs` with EXACTLY:

```js
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
```

The `.cjs` extension forces Node to treat it as CommonJS regardless of the package's `"type": "module"`.

You'll need to create the `scripts/` directory.

- [ ] **Step 4: Run the build to confirm**

Run: `npm run build`

Expected output ends with `prepare-cli: shebang ensured + chmod 755 on dist/cli.js`.

Verify:
```bash
head -1 dist/cli.js   # → should be: #!/usr/bin/env node
ls -l dist/cli.js     # → mode should include x (executable)
./dist/cli.js --help  # → should print the CLI help
```

The third command — calling the file directly without `node` — proves the shebang works.

- [ ] **Step 5: Run tests to confirm nothing else broke**

Run: `npm test`

Expected: all 108 tests still pass.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/prepare-cli.cjs
git commit -m "feat: package as publishable scoped npm module with CLI bin"
```

---

## Task 2: Verify with npm pack + clean install

**Files:**
- (none — verification only)

- [ ] **Step 1: Pack the package**

Run: `npm pack`

Expected: produces a tarball like `davo20019-seo-audit-0.2.0.tgz` in the current directory. **Note the exact filename** — you'll use it next.

Check what's inside:

```bash
tar -tzf davo20019-seo-audit-0.2.0.tgz | head -40
```

Expected: includes `package/dist/`, `package/README.md`, `package/LICENSE`, `package/package.json`. **Should NOT include**: `src/`, `tests/`, `node_modules/`, `docs/`, `*.test.js`, the ricepolak/learnenglishsounds report files, or the plan documents.

If it includes anything you don't want, the `"files"` array in `package.json` is wrong — fix it.

- [ ] **Step 2: Clean install in a tmpdir**

Run:

```bash
TMPDIR_TEST=$(mktemp -d)
cd "$TMPDIR_TEST"
npm init -y > /dev/null
npm install /Users/davidloor/projects/seo-analysis/davo20019-seo-audit-0.2.0.tgz
ls node_modules/@davo20019/seo-audit/dist/
npx seo-audit --help | head -10
cd /Users/davidloor/projects/seo-analysis
```

(Adjust the tarball name if it's slightly different.)

Expected:
- `npm install` completes without errors (Playwright auto-download will happen — that's fine, may take a minute).
- `ls` shows `cli.js`, `analyzer.js`, `index.js`, etc.
- `npx seo-audit --help` prints the CLI help banner.

- [ ] **Step 3: Quick smoke from the tarball-installed binary**

Still inside the tmpdir or after returning to the project, you can also run:

```bash
cd "$TMPDIR_TEST"
npx seo-audit https://example.com --max-pages 2 2>&1 | tail -3
```

Expected: completes without errors. Same output style as `npm run dev`.

- [ ] **Step 4: Clean up the tarball**

```bash
rm /Users/davidloor/projects/seo-analysis/davo20019-seo-audit-0.2.0.tgz
```

(`.tgz` files don't belong in the repo. If you forget, the next `npm pack` will overwrite anyway, but be tidy.)

Add `*.tgz` to `.gitignore` if it isn't already there. Run `cat .gitignore` to check; if missing, append `*.tgz` and commit.

- [ ] **Step 5: Commit gitignore change (if needed)**

If you added `*.tgz` to .gitignore:

```bash
git add .gitignore
git commit -m "chore: ignore npm pack tarballs"
```

If no change was needed, skip this commit.

---

## Task 3: README install instructions + no-telemetry note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Quick Start section**

Find the `## Quick Start` section. Replace it with this:

```markdown
## Install

Run instantly with `npx` (no install needed):

\`\`\`bash
npx @davo20019/seo-audit https://example.com
\`\`\`

Install globally:

\`\`\`bash
npm install -g @davo20019/seo-audit
seo-audit https://example.com --max-pages 25
\`\`\`

Add to a project (use as a library too):

\`\`\`bash
npm install @davo20019/seo-audit
\`\`\`

```ts
import { analyzeSite } from "@davo20019/seo-audit";
const report = await analyzeSite("https://example.com", { maxPages: 50 });
```

## Quick Start (from source)

\`\`\`bash
git clone https://github.com/davo20019/seo-analysis.git
cd seo-analysis
npm install
npm run dev -- https://example.com
\`\`\`

Build the CLI:

\`\`\`bash
npm run build
npm run start -- https://example.com --max-pages 20
\`\`\`

Write JSON output to a file:

\`\`\`bash
npm run dev -- https://example.com --json --output report.json
\`\`\`
```

(Keep the old "Quick Start" content as the new "Quick Start (from source)" section so existing developers aren't broken.)

The triple-backtick fences in the markdown above are literal — write them as-is. The `ts` example is fenced too.

- [ ] **Step 2: Add a "Privacy" section**

Just before the `## License` section at the bottom of README.md, add:

```markdown
## Privacy

This tool does not collect telemetry. No analytics, no phone-home, no install tracking. Crawl reports stay on your machine. The only outbound network traffic is:

- HTTP fetches to the URLs you ask the tool to crawl
- Optional: Google's CrUX API when you pass `--crux` (sends an origin string + your API key)
- Optional: Chromium downloads from Microsoft's Playwright CDN on first install

If a future version ever adds opt-in telemetry, it will be exactly that — opt-in, with explicit disclosure.
```

- [ ] **Step 3: Verify**

Run: `npm test && npm run build`

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add npm install/npx instructions and no-telemetry stance"
```

---

## Task 4: Final verification + push

**Files:** (none)

- [ ] **Step 1: Final test run**

Run: `npm test && npm run build`

Expected: all tests pass, build clean, `dist/cli.js` has shebang and execute bit.

- [ ] **Step 2: Final pack inspection**

Run: `npm pack --dry-run`

Expected: lists files that would be published. Confirm nothing sensitive (no `.env`, no client report files, no plan docs) appears.

- [ ] **Step 3: Confirm clean working tree**

Run: `git status`

Expected: only the untracked artifacts that were already there (ricepolak-*, learnenglishsounds-*, etc.). No staged changes pending. No accidentally-modified files.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin feature/plan-10-npm-publish
```

GitHub will offer a PR link — record it for the user.

---

## What the user does next (NOT part of plan execution)

After merging this branch to main, the user runs:

```bash
npm login                # browser auth, 2FA
npm publish --access public
```

That's the actual publish step. Plan 10 stops at "everything is publish-ready." The user keeps the auth credentials.

---

## Self-Review Notes

- **Spec coverage:** Package metadata (Task 1), shebang plumbing (Task 1), pack verification (Task 2), README polish (Task 3), final verification (Task 4).
- **Placeholder scan:** All steps have concrete code or commands. The `prepare-cli.cjs` script is fully written.
- **Type consistency:** No code-level types changed — only metadata.
- **Boundary respect:** Plan stops short of `npm publish` because that requires user's npm auth, which the controller cannot impersonate.
