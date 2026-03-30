import { execSync, spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "../docs/images/compliance.png");
const BASE = "http://localhost:3000";

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function osa(script) {
  const r = spawnSync("osascript", ["-e", script]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
  return r.stdout.toString().trim();
}

async function main() {
  osa(`tell application "Google Chrome" to activate`);
  await sleep(500);

  const bounds = osa(`
    tell application "Google Chrome"
      set {x1, y1, x2, y2} to bounds of front window
      return (x1 as string) & "," & (y1 as string) & "," & (x2 - x1 as string) & "," & (y2 - y1 as string)
    end tell
  `);
  const [x, y, w, h] = bounds.split(",").map(Number);
  console.log(`Window: ${w}x${h} at (${x},${y})`);

  osa(`tell application "Google Chrome" to set URL of active tab of front window to "${BASE}/dashboard/compliance"`);
  console.log("Navigated to compliance, waiting 8s for full render…");
  await sleep(8000);

  osa(`tell application "Google Chrome" to activate`);
  await sleep(300);
  execSync(`screencapture -R ${x},${y},${w},${h} "${OUT}"`);
  console.log(`Saved: ${OUT}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
