// web/qrcode.js against the system's QR reader (macOS: Core Image, through
// scripts/qr_decode.swift): texts of every version 1 to 10, URLs like the
// page's, UTF-8; each symbol must decode to its text.
//
//   node scripts/check_qrcode.mjs      (make check-qrcode, macOS only)
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { qrMatrix } from "../web/qrcode.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const texts = [
  "A",
  "https://192.168.1.36:8443/20261024-153012-ab12/",
  "https://9f3a-2a01-cb00-1234-5678.ngrok-free.app/20261024-153012-ab12/",
  "http://192.168.1.36:8080/ca.crt",
  "Éléments, cordes frottées, soufflées et frappées ♪",
];
// One text per version: the longest that fits, and one byte more than the
// version before.
for (const n of [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]) texts.push("x".repeat(n - 1) + "!");
const tmp = mkdtempSync(join(tmpdir(), "qr-"));
try {
  const symbols = texts.map((t) => qrMatrix(t));
  writeFileSync(join(tmp, "symbols.txt"), symbols.map((m) => m.map((r) => r.map((d) => (d ? 1 : 0)).join("")).join("\n")).join("\n\n") + "\n");
  const decoded = execFileSync("swift", [join(ROOT, "scripts/qr_decode.swift"), join(tmp, "symbols.txt")], { encoding: "utf8" })
    .split("\n").slice(0, texts.length);
  let failed = 0;
  texts.forEach((t, i) => {
    const ok = decoded[i] === t;
    if (!ok) failed += 1;
    console.log(`${ok ? "ok  " : "FAIL"} version ${(symbols[i].length - 17) / 4}, ${new TextEncoder().encode(t).length} bytes${ok ? "" : `: decoded "${decoded[i]}"`}`);
  });
  console.log(`${texts.length - failed} of ${texts.length} decoded`);
  process.exit(failed ? 1 : 0);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
