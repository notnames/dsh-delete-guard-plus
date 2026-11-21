# CHANGELOG

## 2.0.0 — 2026-11-21

Merge of `dsh-delete-guard` with the quoting-typo analyzer written for one
incident, plus ten rounds of corpus work.

### Added

- `quoting-anomaly`: PowerShell `\"`, a trailing backslash that collapses a
  closing quote, and unbalanced quotes, all fatal when a delete verb is present.
- Dialect-aware tokenizer: bash escapes with `\`, cmd with `^`, PowerShell with a
  backtick. The old single tokenizer mis-read cmd text.
- Nested interpreter analysis: `cmd /c`, `powershell -Command`, `bash -c` payloads
  are re-analysed under the inner dialect, up to three levels.
- `opaque-exec`: `-EncodedCommand`, `FromBase64String`, `Invoke-Expression`,
  `find -delete`, `xargs rm` — refused because the executed text is not visible.
- Platform delete families learned from the ten rounds:
  `service-delete`, `task-delete`, `registry-delete`, `cert-delete`,
  `disk-destructive`, `shadow-delete`, `identity-delete`, `acl-strip`,
  `log-wipe`, `device-delete`, `truncate`, `repo-destructive`,
  `firewall-reset`, `net-reset`, `unc-target`, `workspace-root`, `traversal`.
- `delete_guard_check` tool: pure self-check of a command string.
- Audit log at `~/.dsh/delete-guard-plus/audit.jsonl`.
- Ten-round corpus harness: `scripts/gen-corpus.mjs`, `scripts/run-round.mjs`,
  `scripts/write-round-docs.mjs`, 1,000,000 generated lines, per-round findings.

### Fixed

- **PowerShell resolution**: the bridge now falls back to
  `%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`. Upstream spawned
  `pwsh.exe` only and failed with `ENOENT` on machines without PowerShell 7 —
  observed live on the development machine.
- **`-Format` false positive**: wipe tools are judged in command position only, so
  `Get-Date -Format o` and `Format-List` are no longer mistaken for `format`.
- **cmd quoting**: `\` no longer consumes the next character in cmd text, so
  `rd /s /q "\"` is recognised as a root delete rather than a broken quote.
- **`Move-Item`** removed from the delete verb table; moving a file is not a
  delete.
- **Wildcard operands** (`"dir\*"`) are refused as unprovable regardless of
  recursion, because a glob hides how many entries it removes.
- **Recycle-bin usage counting**: directory payloads are counted as items, and
  byte totals no longer include `$I` metadata.

### Changed

- A provable, deep, literal shell delete is still **refused** by default, with a
  `file_trash` redirect; `allowSafeShellDeletes: true` restores the permissive
  behaviour.
- `file_trash` operand guard additionally refuses `.dsh`, `.ssh`, user-profile
  roots, control characters and wildcards.

### Security

- Nothing is rewritten in flight: `tools/pre-execute` cannot change arguments, so
  the guard denies and names the replacement call. That is deliberate — a rewrite
  would need its own quoting layer, which is the bug this plugin exists for.

## 0.1.0 — 2026-11-21

First local version: `dsh-shell-typo-guard`, 8 rules, 49 unit cases, tested
against a `subst`-mapped fake drive root. Superseded by 2.0.0.
