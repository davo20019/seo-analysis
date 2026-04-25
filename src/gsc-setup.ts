import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { GoogleServiceAccountAuth } from "./enrichment/google-auth.js";

const execFileAsync = promisify(execFile);

const SA_NAME = "seo-audit-bot";
const SA_DISPLAY = "SEO Audit Bot";
const KEY_DIR = resolve(homedir(), ".config", "seo-audit");
const KEY_PATH = resolve(KEY_DIR, "gsc-key.json");
const GSC_USERS_URL = "https://search.google.com/search-console/users";
const SA_CONSOLE_URL = "https://console.cloud.google.com/iam-admin/serviceaccounts";
const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

interface GcloudInfo {
  available: boolean;
  account: string | null;
  project: string | null;
}

export async function runGscSetup(targetUrl?: string): Promise<void> {
  console.log("=== Google Search Console setup ===");
  console.log("");
  console.log("This wizard creates a service account and points it at your GSC property.");
  console.log("Setup is one-time; subsequent runs of `seo-audit --gsc` will be silent.");
  console.log("");

  const gcloud = await detectGcloud();
  let keyPath: string;

  if (gcloud.available && gcloud.project) {
    console.log(`✓ Detected gcloud (account: ${gcloud.account ?? "unknown"}, project: ${gcloud.project})`);
    console.log("");
    const confirmed = await prompt(`Create service account "${SA_NAME}" in project "${gcloud.project}"? [Y/n] `);
    if (!isYes(confirmed)) {
      printManualInstructions();
      return;
    }
    try {
      keyPath = await runAutomatedSetup(gcloud.project);
    } catch (err) {
      console.error("");
      console.error(`Automated setup failed: ${(err as Error).message}`);
      console.error("Falling back to manual instructions.");
      console.error("");
      printManualInstructions();
      return;
    }
  } else {
    if (!gcloud.available) {
      console.log("gcloud CLI not found. Falling back to manual setup.");
    } else {
      console.log("gcloud is installed but no project is selected (`gcloud config set project ...`).");
      console.log("Falling back to manual setup.");
    }
    console.log("");
    printManualInstructions();
    return;
  }

  const email = await readClientEmail(keyPath);
  console.log("");
  console.log("=== Final step: grant the service account access in Search Console ===");
  console.log("");
  console.log(`Email: ${email}`);
  if (targetUrl) {
    console.log(`Property to grant on: ${targetUrl}`);
  }
  console.log(`Open: ${GSC_USERS_URL}`);
  console.log("");
  console.log("Steps:");
  console.log("  1. Open the URL above in your browser.");
  console.log("  2. Select the GSC property you want to audit.");
  console.log("  3. Click \"Add user\", paste the email above, choose \"Restricted\" permission, save.");
  console.log("");
  await prompt("Press Enter when you have granted access… ");

  console.log("");
  process.stdout.write("Verifying credentials… ");
  try {
    const auth = new GoogleServiceAccountAuth({ filePath: keyPath });
    await auth.getAccessToken([GSC_SCOPE]);
    console.log("✓");
  } catch (err) {
    console.log("✗");
    console.error(`  Could not exchange the service-account key for an access token: ${(err as Error).message}`);
    console.error("  Re-run `seo-audit --gsc-setup` if the key was malformed, or contact support.");
    return;
  }

  console.log("");
  console.log("Setup complete. Run an audit:");
  console.log(`  GOOGLE_APPLICATION_CREDENTIALS=${keyPath} seo-audit ${targetUrl ?? "https://your-site.com"} --gsc`);
  console.log("");
  console.log("Tip: add this to your shell profile so the env var is set automatically:");
  console.log(`  export GOOGLE_APPLICATION_CREDENTIALS=${keyPath}`);
}

async function detectGcloud(): Promise<GcloudInfo> {
  try {
    await execFileAsync("gcloud", ["--version"]);
  } catch {
    return { available: false, account: null, project: null };
  }
  let account: string | null = null;
  let project: string | null = null;
  try {
    const { stdout } = await execFileAsync("gcloud", ["config", "get-value", "account"]);
    account = stdout.trim() || null;
  } catch {
    account = null;
  }
  try {
    const { stdout } = await execFileAsync("gcloud", ["config", "get-value", "project"]);
    project = stdout.trim() || null;
    if (project === "(unset)") project = null;
  } catch {
    project = null;
  }
  return { available: true, account, project };
}

async function runAutomatedSetup(project: string): Promise<string> {
  const fullEmail = `${SA_NAME}@${project}.iam.gserviceaccount.com`;

  process.stdout.write(`Creating service account ${SA_NAME}… `);
  try {
    await execFileAsync("gcloud", [
      "iam",
      "service-accounts",
      "create",
      SA_NAME,
      `--display-name=${SA_DISPLAY}`,
      `--project=${project}`,
    ]);
    console.log("✓");
  } catch (err) {
    const message = (err as { stderr?: string }).stderr ?? (err as Error).message;
    if (/already exists/i.test(message)) {
      console.log("(already exists, reusing)");
    } else {
      throw new Error(`gcloud iam service-accounts create failed: ${message.trim()}`);
    }
  }

  await mkdir(KEY_DIR, { recursive: true });

  process.stdout.write(`Downloading key to ${KEY_PATH}… `);
  try {
    await execFileAsync("gcloud", [
      "iam",
      "service-accounts",
      "keys",
      "create",
      KEY_PATH,
      `--iam-account=${fullEmail}`,
      `--project=${project}`,
    ]);
    console.log("✓");
  } catch (err) {
    const message = (err as { stderr?: string }).stderr ?? (err as Error).message;
    throw new Error(`gcloud iam service-accounts keys create failed: ${message.trim()}`);
  }

  await chmod(KEY_PATH, 0o600);
  return KEY_PATH;
}

function printManualInstructions(): void {
  console.log("Manual setup (≈5 minutes):");
  console.log("");
  console.log(`  1. Open ${SA_CONSOLE_URL}`);
  console.log("  2. Select (or create) a Google Cloud project.");
  console.log("  3. Click \"Create service account\".");
  console.log(`     - Name: "${SA_DISPLAY}"`);
  console.log(`     - ID:   "${SA_NAME}"`);
  console.log("  4. Skip the \"Grant access\" step (no GCP roles needed).");
  console.log("  5. Open the new service account → \"Keys\" tab → \"Add key\" → \"JSON\".");
  console.log(`  6. Save the downloaded JSON to ${KEY_PATH}`);
  console.log("     (mkdir -p ~/.config/seo-audit && mv ~/Downloads/*.json ~/.config/seo-audit/gsc-key.json)");
  console.log("  7. chmod 600 the file.");
  console.log("");
  console.log("Then grant the service-account email Restricted access in Search Console:");
  console.log(`  ${GSC_USERS_URL}`);
  console.log("");
  console.log("Finally:");
  console.log(`  export GOOGLE_APPLICATION_CREDENTIALS=${KEY_PATH}`);
  console.log("  seo-audit https://your-site.com --gsc");
}

async function readClientEmail(keyPath: string): Promise<string> {
  try {
    const raw = await readFile(keyPath, "utf8");
    const parsed = JSON.parse(raw) as { client_email?: string };
    if (!parsed.client_email) {
      throw new Error("Key file is missing client_email");
    }
    return parsed.client_email;
  } catch (err) {
    throw new Error(`Could not read service-account email from ${keyPath}: ${(err as Error).message}`);
  }
}

async function prompt(message: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(message);
  } finally {
    rl.close();
  }
}

function isYes(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" || trimmed === "y" || trimmed === "yes";
}

// Used in tests; not strictly necessary at runtime.
export const _internal = {
  KEY_PATH,
  SA_NAME,
  detectGcloud,
  readClientEmail,
  printManualInstructions,
  ensureDir: () => mkdir(dirname(KEY_PATH), { recursive: true }).then(() => writeFile),
};
