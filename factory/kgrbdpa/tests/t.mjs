// tiny assertion helper: check(name, ok, detail) … done() prints a summary and sets the exit code
let pass = 0, fail = 0; const fails = [];
export function check(name, ok, detail = "") {
  if (ok) pass++; else { fail++; fails.push(name + (detail ? "  — " + detail : "")); }
  if (process.env.VERBOSE || !ok) console.log((ok ? "  ok  " : "  FAIL ") + name + (detail ? "  — " + detail : ""));
}
export const near = (a, b, tol) => Math.abs(a - b) <= tol;
export function done(label = "") {
  console.log(`${label ? label + ": " : ""}${pass} passed, ${fail} failed`);
  if (fail) { console.log("FAILURES:\n  " + fails.join("\n  ")); process.exitCode = 1; }
}
