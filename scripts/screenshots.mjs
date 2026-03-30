import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../docs/images");
const BASE = "http://localhost:3000";

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PAGES = [
  { path: "/dashboard",                  file: "dashboard.png",        name: "GCP Overview" },
  { path: "/dashboard/findings",         file: "findings.png",         name: "Security Findings" },
  { path: "/dashboard/compliance",       file: "compliance.png",       name: "Compliance" },
  { path: "/dashboard/trace",            file: "request-tracer.png",   name: "Request Tracer" },
  { path: "/dashboard/aws",              file: "aws-overview.png",     name: "AWS Overview" },
  { path: "/dashboard/aws/findings",     file: "aws-findings.png",     name: "AWS Findings" },
  { path: "/dashboard/service-accounts", file: "service-accounts.png", name: "Service Accounts" },
  { path: "/dashboard/settings",         file: "settings.png",         name: "Settings" },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function osa(script) {
  const r = spawnSync("osascript", ["-e", script]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
}

async function main() {
  console.log("Focusing Chrome…");
  osa(`tell application "Google Chrome" to activate`);
  await sleep(500);

  // Get Chrome window bounds
  const bounds = osa(`
    tell application "Google Chrome"
      set {x1, y1, x2, y2} to bounds of front window
      return (x1 as string) & "," & (y1 as string) & "," & (x2 - x1 as string) & "," & (y2 - y1 as string)
    end tell
  `);
  const [x, y, w, h] = bounds.split(",").map(Number);
  console.log(`Window: ${w}x${h} at (${x},${y})\n`);

  // Verify signed in
  osa(`tell application "Google Chrome" to set URL of active tab of front window to "${BASE}/dashboard"`);
  await sleep(3000);
  const url = osa(`tell application "Google Chrome" to get URL of active tab of front window`);
  if (url.includes("/login")) {
    console.error("Not signed in. Please sign in at http://localhost:3000 in Chrome first.");
    process.exit(1);
  }
  console.log("Session active.\n");

  for (const { path: p, file, name } of PAGES) {
    process.stdout.write(`  ${name}…`);
    osa(`tell application "Google Chrome" to set URL of active tab of front window to "${BASE}${p}"`);
    await sleep(4000);
    // Re-focus Chrome immediately before capture so terminal doesn't steal the frame
    osa(`tell application "Google Chrome" to activate`);
    await sleep(300);
    const out = path.join(OUT, file);
    execSync(`screencapture -R ${x},${y},${w},${h} "${out}"`);
    console.log(` ✓`);
  }

  console.log(`\nSaved ${PAGES.length} screenshots to docs/images/`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
