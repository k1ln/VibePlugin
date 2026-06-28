// wav-to-b64.mjs — decode any audio file to mono Int16-LE PCM at a target
// sample rate (via ffmpeg) and print its base64 to stdout, for embedding a
// sample into an AssemblyScript module (see SAMPLE_TEMPLATE.ts).
//
//   node factory/tools/wav-to-b64.mjs <input-audio> [rate=22050] [maxSeconds=6] > sample.b64
//
// Diagnostics (frames, duration, base64 size) go to stderr so stdout is pure base64.
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , input, rateArg, maxSecArg] = process.argv;
if (!input) { console.error("usage: node wav-to-b64.mjs <input-audio> [rate] [maxSeconds]"); process.exit(2); }
const rate = +(rateArg || 22050);
const maxSec = +(maxSecArg || 6);

const tmp = join(tmpdir(), "wb_" + process.pid + ".raw");
try {
  execFileSync("ffmpeg", ["-y", "-t", String(maxSec), "-i", input, "-ac", "1", "-ar", String(rate), "-f", "s16le", "-acodec", "pcm_s16le", tmp], { stdio: ["ignore", "ignore", "inherit"] });
} catch (e) {
  console.error("ffmpeg decode failed for " + input);
  process.exit(1);
}
const buf = readFileSync(tmp);
try { unlinkSync(tmp); } catch {}
const frames = buf.length / 2;
const b64 = buf.toString("base64");
console.error(`decoded: frames=${frames}  dur=${(frames / rate).toFixed(3)}s  rate=${rate}  base64Chars=${b64.length}  (~${Math.round(b64.length / 1024)}KB in wasm)`);
process.stdout.write(b64);
