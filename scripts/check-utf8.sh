#!/usr/bin/env bash
# =====================================================================
#  scripts/check-utf8.sh — guard against mojibake in the C++ strings.
#
#  juce::String's const char* constructor decodes Latin-1 (one byte -> one
#  codepoint), so a UTF-8 literal like "—" surfaces in the UI as "â" plus
#  two invisible control chars. Every non-ASCII literal must therefore reach
#  JUCE through vstai::u8() (Utf8.h) or juce::String::fromUTF8().
#
#  This flags ordinary "…" literals in src/ that carry a non-ASCII character
#  without a decoder wrapped around them. Comments and R"raw(…)raw" literals
#  are skipped: a raw literal is a const char* that must instead be wrapped
#  where it is turned into a juce::String (see kSystemPrompt, kDefaultHtml).
#
#  Run standalone, or via scripts/build.sh which calls it before building.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import pathlib, re, sys

DECODERS = ("vstai::u8 (", "vstai::u8(", "fromUTF8 (", "fromUTF8(", "CharPointer_UTF8 (")

def literals(src):
    """Spans of ordinary string literals; comments, char and raw literals skipped."""
    i, n, out = 0, len(src), []
    while i < n:
        c = src[i]
        if c == '/' and src[i+1:i+2] == '/':
            j = src.find('\n', i); i = n if j < 0 else j
        elif c == '/' and src[i+1:i+2] == '*':
            j = src.find('*/', i + 2); i = n if j < 0 else j + 2
        elif c == "'":
            i += 1
            while i < n and src[i] != "'":
                i += 2 if src[i] == '\\' else 1
            i += 1
        elif c == 'R' and src[i+1:i+2] == '"':
            m = re.compile(r'R"([^(]*)\(').match(src, i)
            end = src.find(')' + m.group(1) + '"', m.end())
            i = n if end < 0 else end + len(m.group(1)) + 2
        elif c == '"':
            start = i; i += 1
            while i < n and src[i] != '"':
                i += 2 if src[i] == '\\' else 1
            i += 1
            out.append((start, i))
        else:
            i += 1
    return out

bad = []
for f in sorted(pathlib.Path("src").rglob("*")):
    if f.suffix not in (".h", ".cpp", ".mm") or not f.is_file():
        continue
    src = f.read_text(encoding="utf-8")
    for s, e in literals(src):
        lit = src[s:e]
        # A \xNN escape >= 0x80 is UTF-8 bytes too, even though the source is ASCII.
        if lit.isascii() and not any(int(h, 16) >= 0x80 for h in re.findall(r'\\x([0-9a-fA-F]{2})', lit)):
            continue
        before = src[max(0, s - 80):s]
        if any(d in before for d in DECODERS):
            continue
        line = src.count("\n", 0, s) + 1
        bad.append(f"  {f}:{line}: {lit[:90]}")

if bad:
    print("✗ non-ASCII literal handed to JUCE undecoded — wrap it in vstai::u8():", file=sys.stderr)
    print("\n".join(bad), file=sys.stderr)
    sys.exit(1)
print("✓ utf8: every non-ASCII literal goes through vstai::u8()/fromUTF8()")
PY
