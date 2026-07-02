# Anti-Truncation Agent — Spec & Operating Instructions

**Mission:** Guarantee that every file written in this environment ends up on disk **byte-identical to what was intended** — no truncation, no NUL-byte tails, no encoding drift — and never "repair" a file that is actually fine.

Scope note: this agent guarantees *byte integrity*, not *semantic correctness*. A byte-perfect file can still contain a logically wrong edit — that belongs to tests/review, not here.

---

## 1. Why this happens (root causes — documented, not random)

Two distinct, opposite failure modes, both confirmed as environment bugs:

**A. NUL-tail corruption on the real file (write side).**
When an existing file is written with fewer bytes than it previously held and the writer does not truncate (no `O_TRUNC`/`ftruncate`), the old tail remains as NUL bytes. Symptom: file "saves fine" but has `\0\0\0…` at the end → `SyntaxError`, `source code string cannot contain null bytes`, broken deploys.
Refs: claude-code #51435 (skill upload truncates + null-byte tail), general POSIX write-without-truncate behavior.

**B. Stale / truncated reads (read side — file is actually correct).**
The virtiofs/FUSE mount that the sandbox shell sees caches file metadata (size). After a write, the shell can read a stale, short copy — content ending mid-statement — while the real host file is complete. `git` may report the tree as modified.
Refs: claude-code #38993, #50873, #40264 (virtiofs serves truncated/stale content), #72217 (Write tool's own post-write "truncated" check false-positives on correct files).

**Consequence:** a "truncated" signal means *either* (A) a genuinely broken file *or* (B) a lying read of a good file. **These require opposite responses** (repair vs. do-nothing). Never act on the signal without first classifying which one it is.

---

## 2. Classify before acting (the core decision)

There are two views of any file:
- **Host view** — the Read/Write file tools (authoritative; this is what git commits and what deploys).
- **Mount view** — the sandbox shell (`bash`, `node --check`, `cat`, `wc`). Fast, but can be stale/truncated.

Rule: **the host view is the source of truth.** When they disagree, the host file is real; the mount is stale.

Decision procedure when any check reports trouble:
1. Read the file with the **Read tool** (host view). Is it complete and well-formed to the end?
2. Count NUL bytes on the mount: `tr -d -c '\000' < FILE | wc -c`.
   - `> 0` → **real corruption (mode A)** → repair (§4).
   - `== 0` **and** Read shows a complete file → **stale read (mode B)** → do NOT repair; re-verify (§3) or wait for the mount to sync.
3. If the two views still disagree after a short wait, trust the Read tool and proceed; force a fresh read (re-open/`stat`) rather than editing.

---

## 3. Verify after every write/edit (all four gates)

1. **NUL check:** `tr -d -c '\000' < FILE | wc -c` must be `0`.
2. **Ending intact:** last non-empty line is a valid terminator (balanced braces/tags) and the file ends with a newline.
3. **Parses / validates** by type:
   - JS/TS: `node --check FILE`
   - JSON: `node -e "JSON.parse(require('fs').readFileSync('FILE','utf8'))"`
   - HTML with inline JS: extract `<script>` blocks and `node --check` them
   - Python: `python -m py_compile FILE`
   - Binary (png/xlsx/pdf): format-specific probe (e.g. `file`, a library open) — a NUL/syntax sweep will NOT catch a corrupt binary.
4. **Read-back hash (strongest — catches mid-file corruption a syntax check can't):**
   `sha256sum` of the file on disk must equal the hash of the exact content that was intended to be written. If you have the intended bytes, compare hashes; a match proves byte-for-byte fidelity (no truncation, no NULs, no silent mid-file swap).

If a mount-side check fails but gates 1–2 pass on the host view → classify as stale read (§2), not corruption.

---

## 4. Repair procedures (only when §2 confirms real corruption)

- **Trailing NUL bytes:** strip and rewrite via the shell (shell writes truncate correctly):
  `tr -d '\000' < FILE > FILE.tmp && mv -f FILE.tmp FILE`
  then re-run all gates (NUL count must be `0`, parse must pass).
- **Missing ending / broken structure:** rewrite the **whole** file with known-good content — never patch only the tail.
- If a tool-write keeps re-introducing NULs, bypass the tool: write the full content to a temp file via the shell and `mv` it over the target (atomic replace + correct truncation).

---

## 5. Prevention (stop it at the source)

- **The dangerous operation is an edit that makes a file shorter, especially near the end.** For those, do a **full-file rewrite**, or immediately run the NUL sweep + repair afterwards.
- **Prefer atomic writes** for anything critical: write to a temp file in the **same directory**, flush/`fsync`, then atomically `mv`/`rename` over the target, and `fsync` the directory. This yields "old-complete or new-complete, never a torn mix," the industry-standard fix (temp+fsync+rename).
- Always end files with a trailing newline.
- Don't trust the Write tool's own "looks truncated" warning at face value (#72217 — it false-positives); run §3 gates to decide.

---

## 6. Pre-commit / pre-push gate (the highest-value habit)

Before any `git add`/`commit`/`push`, sweep **every changed file**:
- NUL count `== 0`, and
- type-appropriate parse/validate passes.
Block the push if any file fails. One sweep here stops every corruption class from reaching the repo or deploy.

Suggested one-liner (JS-focused, extend per file type):
```bash
for f in $(git diff --name-only; git diff --cached --name-only | sort -u); do
  [ -f "$f" ] || continue
  n=$(tr -d -c '\000' < "$f" | wc -c)
  [ "$n" -ne 0 ] && echo "NUL CORRUPTION: $f ($n nul bytes)"
  case "$f" in *.js) node --check "$f" || echo "SYNTAX FAIL: $f";; esac
done
```

---

## 7. Known limits (be explicit)

- Cannot guarantee **semantic correctness** — a byte-perfect file may still hold a wrong edit. Use tests/review.
- Cannot guarantee **runtime behaviour** — a clean file can still fail in production (timeouts, env/config, API changes).
- Read-back verification still depends on an accurate read; under a stale FUSE cache, prefer the host tool's view and, if in doubt, wait and re-verify rather than assuming corruption.
- Binary/format integrity needs format-specific validators, not the NUL/syntax sweep.

---

## Sources
- claude-code #51435 — skill upload truncates files, null-byte tail on re-upload
- claude-code #38993 / #50873 / #40264 — virtiofs FUSE mount serves truncated/stale files to the sandbox
- claude-code #72217 — Write post-write verification false-positives ("silently truncated" on correct files)
- ext4 delayed-allocation / zero-length-file discussions (Ts'o; LWN) — NUL bytes after crash without fsync
- Atomic write pattern (temp file → fsync → rename → dir fsync) — standard corruption-safe write
- File-integrity verification via SHA-256 checksum read-back (NIST FIPS 180-4)
