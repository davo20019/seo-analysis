# Plan 9 — GitHub Action Wrapper

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add an `action.yml` at the repo root so anyone can install this audit in their CI in 3 lines:

```yaml
- uses: davo20019/seo-analysis@v1
  with:
    url: https://example.com
    fail-on: high
```

**Architecture:** Composite action (no Docker, no JS bundle). Runner installs Node, npm-installs the action's dependencies, builds, runs the CLI with the user-supplied inputs, parses the JSON report, and emits structured outputs. Self-contained — no external services, no npm publish required first.

**Tech Stack:** GitHub Actions composite syntax + bash. No new code dependencies.

**Scope exclusions:**
- PR comment-bot integration (auto-post audit summary as a PR comment) — useful but better as a separate higher-level action consumers compose around this one.
- Marketplace publishing (the `name`/`description` metadata in action.yml is enough; the actual marketplace listing is a button-click on a release page, done by the user).
- Once Plan 10 ships (npm publish), the action could `npm install -g @davo20019/seo-audit` instead of building from source. That's a follow-up optimization, not a blocker.

---

## File Structure

New:
- `action.yml` — composite action definition at repo root.
- `.github/workflows/example-seo-audit.yml` — example consumer workflow showing PR-gating usage.

Modified:
- `README.md` — add a "GitHub Action" section.

No code changes in `src/` or `tests/`. The Action is purely CI plumbing.

---

## Task 1: Create action.yml

**Files:**
- Create: `action.yml`

- [ ] **Step 1: Write the action manifest**

Create `action.yml` at the project root with EXACTLY this content:

```yaml
name: "SEO Audit"
description: "Crawl-based SEO audit (technical, schema, sitemap, CrUX, JS rendering). Fails CI on regressions."
branding:
  icon: "search"
  color: "purple"

inputs:
  url:
    description: "URL to crawl (required)."
    required: true
  max-pages:
    description: "Maximum pages to crawl. Default 50."
    required: false
    default: "50"
  concurrency:
    description: "Number of pages fetched in parallel. Default uses the CLI default (6)."
    required: false
    default: ""
  render:
    description: "Render pages with headless Chromium (true|false). Default false."
    required: false
    default: "false"
  fail-on:
    description: "Exit non-zero if issues at this severity increased. One of: high, medium, low. Empty = never fail."
    required: false
    default: ""
  crux:
    description: "Query Google CrUX API for real-user Core Web Vitals (true|false). Requires crux-api-key."
    required: false
    default: "false"
  crux-api-key:
    description: "Google API key for CrUX. Use a repo secret."
    required: false
    default: ""
  user-agent:
    description: "Override the User-Agent header sent by the crawler."
    required: false
    default: ""
  include-paths:
    description: "Comma-separated regex patterns; only crawl URLs matching at least one."
    required: false
    default: ""
  exclude-paths:
    description: "Comma-separated regex patterns; skip URLs matching any."
    required: false
    default: ""
  output-json:
    description: "Path to write the JSON report. Default seo-report.json."
    required: false
    default: "seo-report.json"
  output-html:
    description: "Optional path to write an HTML report."
    required: false
    default: ""

outputs:
  high-issues:
    description: "Total high-severity issues across all pages."
    value: ${{ steps.parse.outputs.high }}
  medium-issues:
    description: "Total medium-severity issues across all pages."
    value: ${{ steps.parse.outputs.medium }}
  low-issues:
    description: "Total low-severity issues across all pages."
    value: ${{ steps.parse.outputs.low }}
  pages-crawled:
    description: "Number of pages successfully crawled."
    value: ${{ steps.parse.outputs.pages }}
  report-path:
    description: "Path to the JSON report (relative to the consumer's workspace)."
    value: ${{ steps.run.outputs.report-path }}

runs:
  using: composite
  steps:
    - name: Set up Node.js
      uses: actions/setup-node@v4
      with:
        node-version: "20"

    - name: Install action dependencies
      shell: bash
      working-directory: ${{ github.action_path }}
      run: npm ci || npm install

    - name: Build CLI
      shell: bash
      working-directory: ${{ github.action_path }}
      run: npm run build

    - name: Run audit
      id: run
      shell: bash
      env:
        SEO_INPUT_URL: ${{ inputs.url }}
        SEO_INPUT_MAX_PAGES: ${{ inputs.max-pages }}
        SEO_INPUT_CONCURRENCY: ${{ inputs.concurrency }}
        SEO_INPUT_RENDER: ${{ inputs.render }}
        SEO_INPUT_FAIL_ON: ${{ inputs.fail-on }}
        SEO_INPUT_CRUX: ${{ inputs.crux }}
        SEO_INPUT_USER_AGENT: ${{ inputs.user-agent }}
        SEO_INPUT_INCLUDE_PATHS: ${{ inputs.include-paths }}
        SEO_INPUT_EXCLUDE_PATHS: ${{ inputs.exclude-paths }}
        SEO_INPUT_OUTPUT_JSON: ${{ inputs.output-json }}
        SEO_INPUT_OUTPUT_HTML: ${{ inputs.output-html }}
        CRUX_API_KEY: ${{ inputs.crux-api-key }}
      run: |
        set -euo pipefail
        ARGS=("$SEO_INPUT_URL" "--json" "--output" "$SEO_INPUT_OUTPUT_JSON")

        if [ -n "$SEO_INPUT_MAX_PAGES" ]; then
          ARGS+=("--max-pages" "$SEO_INPUT_MAX_PAGES")
        fi
        if [ -n "$SEO_INPUT_CONCURRENCY" ]; then
          ARGS+=("--concurrency" "$SEO_INPUT_CONCURRENCY")
        fi
        if [ "$SEO_INPUT_RENDER" = "true" ]; then
          ARGS+=("--render")
        fi
        if [ "$SEO_INPUT_CRUX" = "true" ]; then
          ARGS+=("--crux")
        fi
        if [ -n "$SEO_INPUT_USER_AGENT" ]; then
          ARGS+=("--user-agent" "$SEO_INPUT_USER_AGENT")
        fi
        if [ -n "$SEO_INPUT_OUTPUT_HTML" ]; then
          ARGS+=("--html-report" "$SEO_INPUT_OUTPUT_HTML")
        fi

        IFS=',' read -ra INCLUDES <<< "$SEO_INPUT_INCLUDE_PATHS"
        for p in "${INCLUDES[@]}"; do
          if [ -n "$p" ]; then ARGS+=("--include-path" "$p"); fi
        done

        IFS=',' read -ra EXCLUDES <<< "$SEO_INPUT_EXCLUDE_PATHS"
        for p in "${EXCLUDES[@]}"; do
          if [ -n "$p" ]; then ARGS+=("--exclude-path" "$p"); fi
        done

        node "${{ github.action_path }}/dist/cli.js" "${ARGS[@]}"
        echo "report-path=$SEO_INPUT_OUTPUT_JSON" >> "$GITHUB_OUTPUT"

    - name: Parse summary
      id: parse
      shell: bash
      env:
        REPORT_PATH: ${{ inputs.output-json }}
      run: |
        set -euo pipefail
        node -e "
          const fs = require('node:fs');
          const raw = JSON.parse(fs.readFileSync(process.env.REPORT_PATH, 'utf8'));
          const r = Array.isArray(raw) ? raw[0] : raw;
          const t = r.summary.issueTotals;
          const out = process.env.GITHUB_OUTPUT;
          fs.appendFileSync(out, 'high=' + t.high + '\n');
          fs.appendFileSync(out, 'medium=' + t.medium + '\n');
          fs.appendFileSync(out, 'low=' + t.low + '\n');
          fs.appendFileSync(out, 'pages=' + r.summary.crawledPages + '\n');
        "

    - name: Apply fail-on gate
      if: ${{ inputs.fail-on != '' }}
      shell: bash
      env:
        FAIL_ON: ${{ inputs.fail-on }}
        HIGH: ${{ steps.parse.outputs.high }}
        MEDIUM: ${{ steps.parse.outputs.medium }}
        LOW: ${{ steps.parse.outputs.low }}
      run: |
        set -euo pipefail
        case "$FAIL_ON" in
          high) COUNT="$HIGH" ;;
          medium) COUNT="$MEDIUM" ;;
          low) COUNT="$LOW" ;;
          *) echo "Invalid fail-on: $FAIL_ON (must be high|medium|low)"; exit 2 ;;
        esac
        if [ "$COUNT" -gt 0 ]; then
          echo "::error::SEO audit failed: $COUNT $FAIL_ON-severity issue(s) detected."
          exit 1
        fi
        echo "fail-on $FAIL_ON: 0 issues — passing."
```

Key design notes for the implementer:

- The action runs in a composite. Each `run:` step uses bash explicitly. `working-directory: ${{ github.action_path }}` makes npm and tsc resolve files inside the action's checkout (not the consumer's), but the audit run executes in the consumer's workspace (default working dir for the `run` step), so the report path is relative to their checkout.
- `node "${{ github.action_path }}/dist/cli.js"` is the absolute path to the built CLI — necessary because the `run` step's CWD is the consumer's repo, not ours.
- `set -euo pipefail` is the bash safety belt (fail fast on errors, undefined vars, pipeline failures).
- `fail-on` is implemented in the action wrapper rather than passing through to the CLI's `--fail-on` flag because the CLI's flag is currently scoped to `diff` mode only. The wrapper directly inspects the parsed counts and exits non-zero if appropriate.

- [ ] **Step 2: Lint the YAML by parsing it**

The YAML must be valid. Verify:

```bash
node -e "const yaml=require('node:fs').readFileSync('action.yml','utf8'); const s=require('node:fs').readFileSync('package.json','utf8'); console.log('action.yml bytes:', yaml.length); console.log('first 80 chars:', JSON.stringify(yaml.slice(0,80)))"
```

(There's no YAML parser in Node stdlib; that's just a sanity check that the file isn't empty/binary. The real validation happens when GitHub parses it on push.)

For an actual YAML lint, if you have `npx` and want to be thorough:

```bash
npx --yes js-yaml action.yml > /dev/null && echo "YAML parses cleanly"
```

(Skip this if it adds friction — GitHub will surface YAML errors on the next push.)

- [ ] **Step 3: Build still works**

Run: `npm run build && npm test`

Expected: clean. The action.yml file isn't compiled or tested by these — they should pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add action.yml
git commit -m "feat: add GitHub Action for SEO audit (composite)"
```

---

## Task 2: Example workflow

**Files:**
- Create: `.github/workflows/example-seo-audit.yml`

This is a *demo* workflow showing how a consumer would use the action. It runs in this repo too (audits example.com on PR), so it doubles as an integration test.

- [ ] **Step 1: Create the example workflow**

Create `.github/workflows/example-seo-audit.yml`:

```yaml
name: Example SEO Audit

on:
  pull_request:
    branches: [main]
  workflow_dispatch:
    inputs:
      url:
        description: "URL to audit"
        required: true
        default: "https://example.com"

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run SEO audit
        id: seo
        uses: ./
        with:
          url: ${{ github.event.inputs.url || 'https://example.com' }}
          max-pages: "5"
          fail-on: high

      - name: Show results
        run: |
          echo "Pages crawled: ${{ steps.seo.outputs.pages-crawled }}"
          echo "High: ${{ steps.seo.outputs.high-issues }}"
          echo "Medium: ${{ steps.seo.outputs.medium-issues }}"
          echo "Low: ${{ steps.seo.outputs.low-issues }}"

      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: seo-report
          path: ${{ steps.seo.outputs.report-path }}
```

The `uses: ./` syntax tells Actions to use the action defined in this repo's root (where `action.yml` lives). External consumers would write `uses: davo20019/seo-analysis@v1` instead.

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/example-seo-audit.yml
git commit -m "ci: add example workflow consuming the SEO audit action"
```

---

## Task 3: README — GitHub Action section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a section after Diff Reports, before Keyword Search**

Insert this section in `README.md`:

```markdown
## GitHub Action

Run SEO audits in CI without writing any glue code:

\`\`\`yaml
# .github/workflows/seo.yml
name: SEO Audit
on: [pull_request]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: davo20019/seo-analysis@v1
        with:
          url: https://staging.mysite.com
          max-pages: 50
          fail-on: high   # block PRs that introduce high-severity issues
\`\`\`

### Inputs

| Input | Default | Description |
|---|---|---|
| \`url\` | (required) | URL to crawl |
| \`max-pages\` | \`50\` | Maximum pages to crawl |
| \`concurrency\` | (CLI default) | Pages fetched in parallel |
| \`render\` | \`false\` | Use Playwright for JS rendering |
| \`fail-on\` | (none) | Fail the workflow if issues at this severity exist (\`high\`, \`medium\`, \`low\`) |
| \`crux\` | \`false\` | Query Google CrUX for real-user Core Web Vitals |
| \`crux-api-key\` | (none) | API key for CrUX (use a repo secret) |
| \`user-agent\` | (default) | Override the crawler's User-Agent |
| \`include-paths\` | (none) | Comma-separated regex; only crawl matching URLs |
| \`exclude-paths\` | (none) | Comma-separated regex; skip matching URLs |
| \`output-json\` | \`seo-report.json\` | Where to write the JSON report |
| \`output-html\` | (none) | Optional path for the HTML report |

### Outputs

| Output | Description |
|---|---|
| \`high-issues\` | Count of high-severity issues |
| \`medium-issues\` | Count of medium-severity issues |
| \`low-issues\` | Count of low-severity issues |
| \`pages-crawled\` | Number of pages successfully crawled |
| \`report-path\` | Path to the JSON report (use with \`actions/upload-artifact\`) |
```

(The triple-backticks are literal markdown; write them as-is. The YAML inside the first code block uses `\`\`\`yaml`.)

- [ ] **Step 2: Verify**

Run: `npm test && npm run build`

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document GitHub Action with inputs and outputs reference"
```

---

## Self-Review Notes

- **Spec coverage:** Composite action manifest (Task 1), example consumer workflow (Task 2), README docs (Task 3). All inputs/outputs round-trip from action.yml → README table → example workflow.
- **Placeholder scan:** action.yml is fully written, including the bash for parsing the report into outputs and the fail-on gate.
- **Type consistency:** Inputs are GitHub Actions strings (everything is a string at the YAML layer). Booleans are compared as `"true"`. Severities validated by case statement.
- **Cross-plan compat:** The action calls the CLI's existing flags (`--max-pages`, `--render`, `--crux`, `--user-agent`, `--include-path`, `--exclude-path`, `--html-report`, `--json`, `--output`). No CLI changes needed. `fail-on` is implemented in the wrapper, not passed through, because the CLI's `--fail-on` flag is currently `diff`-mode-only.
