# Data safety — how ServiceAuto protects (and recovers) customer data

## Where data lives

| What | Location (packaged app) |
| --- | --- |
| Finalized fișe (`.json` + `.pdf`) | `%APPDATA%\Service Auto\date\fise` (or the folder chosen in Settings) |
| Drafts (autosaved) | `…\date\drafturi` |
| Trash (30 days) | `…\date\trash` |
| Corrupt files (kept, never deleted) | `…\date\corupte` |
| Company settings | `…\date\setari.json` |
| Sequence counter | `…\date\contor.json` (written only AFTER the fișă is on disk, so a failed save never burns an invoice number; numbers are also re-derived from fișe + trash, so this file is not critical) |
| Local backup mirror + overwritten versions | `…\date\backup\{mirror,history}` |
| **Independent safety backup** | `%APPDATA%\Service Auto\safety-backup\{fise,drafturi,history,snapshots}` |
| License (machine-bound) | `%APPDATA%\Service Auto\license.dat` |

Data is never stored next to the `.exe` (an NSIS update wipes the install folder).

## What protects against what

| Risk | Protection |
| --- | --- |
| Crash / power loss mid-write | Atomic writes (temp file → fsync → rename); orphan `.tmp-*` and 0-byte files cleaned at start |
| Closing the window right after typing | Renderer flushes the draft before the window closes (`lifecycle.js`), then a final backup runs |
| Switching fișă within 1 s of typing | `autosaver.flush()` before every switch; if the save fails, the switch is refused |
| Save failure (disk full) | Red "Nesalvat" chip, automatic retry every 5 s, close/switch guarded |
| Two app instances | Single-instance lock |
| Accidental delete of a fișă | Moved to `trash/` for 30 days, "Anulează" toast, Settings → trash |
| Edit overwrites an issued invoice | Previous version archived to `history/` (2 independent copies) before overwrite |
| Corrupt JSON | Quarantined to `corupte/`, restored from mirror/safety-backup if a good copy exists; a corrupt file never overwrites a good backup copy |
| Fișă deleted by antivirus / by hand | Healed from the safety-backup at next start (not for fișe deleted *inside* the app — those are in the trash) |
| Whole data folder gone | Restored from the safety-backup at next start |
| Custom data folder unplugged (USB/network) | Works in `date-temporar`, persistent banner; work is merged back when the folder returns |
| Bad backup / bad edit propagating | Daily snapshot bundles (`safety-backup\snapshots`, 30 kept) |
| Corrupt `app-config.json` (holds the custom data folder) | Bad file copied to `app-config.json.corrupt-<time>`, config restored from `app-config.json.bak` (last good version, kept on every write); writes are atomic. A missing `app-config.json` is restored from `.bak`. If no good `.bak` exists, the next write is allowed only once the `.corrupt-<time>` copy is saved (so the bad content is never lost); otherwise the write is refused with an error and a data-folder change is aborted before switching folders |
| Fișă briefly unreadable at start (antivirus lock) | Skipped, not quarantined; re-read on the next list/search until it loads (no restart needed) |
| Hand-edited / oversize entry in an imported backup | Each entry is migrated + sanitized before writing; unusable ones (e.g. > 300 lines) are skipped and counted as `invalide`, the rest is imported |
| Update installation | Draft flush + final backup before `quitAndInstall` |

Manual tools (Settings → Backup): backup now, export a backup file (e.g. to USB), restore from a file or from the latest snapshot. Restore **only adds what is missing** and never overwrites an existing fișă.

## Recovering by hand

* A fișă that was overwritten by an edit: `…\date\backup\history\<NAME>__<timestamp>.json` (copy of the older version).
* A fișă deleted by mistake > 30 days ago: the newest `snapshot-*.json` that predates the deletion (Settings → Restore from file).
* Restored fișe have no PDF; it is regenerated automatically when the fișă is opened/printed.

## Owner-only (not in the repo)

* Run `npm run keys:backup -- D:\Backups` (any folder, e.g. a USB stick): it packs `keys/` into ONE password-protected file (`keys-backup-YYYY-MM-DD.sakeys`, AES-256-GCM + scrypt), verifies it can be decrypted, and prints the restore command (`npm run keys:restore -- <file>`). Keep the file and the password in different places, off this PC.
* `keys/private.pem` is the **only** key that can issue licenses (the public key is embedded in the app). Keep an encrypted copy off this machine (password manager / offline USB). If it is lost, no new license can ever be issued for the shipped app.
* `keys/licenses.json` is the issued-license registry — back it up together with the key.
* Revoked licenses are read-only, not locked: the customer can still open, search, print and export their data.

## Tests

`npm test` runs the data-safety suite (fault injection, corruption, recovery, concurrency, lifecycle). It runs in CI on every push and gates the release workflow. `node tests/e2e/run.mjs` drives the real built app (Playwright + Electron) — see the header of that file.
