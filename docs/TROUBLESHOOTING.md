# Troubleshooting

## Start here

Run `npm run doctor` first — it names the failing check and the fix. The table
below maps each check id to the same fix in prose.

| Doctor check              | Symptom                                                                                                                                      | Fix                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `node_version` ✖          | `✖ Node.js  v20.x is too old`                                                                                                                | Node ≥ 22 (`brew install node`, or `fnm install 22` to pin)                           |
| `database_file` ✖         | `Index file` reports `not found at …`; nothing to search locally                                                                             | `npm run build:index`                                                                 |
| `database_readable` ✖     | `Symbols` reports `index is unreadable or corrupt (file is not a database)`; every dependent row fails too, so nothing is scored or filtered | `npm run build:index` (the file is not SQLite; rebuilding is the only repair)         |
| `fts_index` ✖             | FTS rows ≠ symbol rows; search returns nothing or misses symbols it should match                                                             | `npm run build:index`                                                                 |
| `kind_integrity` ⚠        | a `symbolType` filter silently omits rows whose kind was never classified                                                                    | `npm run repair-index -- --apply`                                                     |
| `attribution_integrity` ⚠ | a framework filter returns another framework's symbol                                                                                        | `npm run repair-index -- --apply`                                                     |
| `provider_available` ⚠    | `none configured` — `semantic_search` behaves like keyword search                                                                            | set `GEMINI_API_KEY` or `APPLE_DOCS_EMBEDDING_MODEL_PATH`, then `npm run embed-index` |
| `semantic_layer` ⚠        | under 100 vectors, so `get_version` reports `Lexical only (SQLite FTS5)`                                                                     | `npm run embed-index`                                                                 |
| `dimension_consistency` ✖ | stored vector width ≠ provider width; cosine scores are meaningless after changing dimensions                                                | `npm run embed-index -- --force`                                                      |
| `snapshot_freshness` ⚠    | snapshot older than 30 days; a new API returns "symbol not found"                                                                            | `npm run build:index`                                                                 |

`✔` is healthy, `⚠` is degraded but working, `✖` is a failure. The run exits `1`
when any check fails; add `--strict` (`npm run doctor -- --strict`) to also exit
`1` on warnings. `npm run doctor -- --json` prints one envelope,
`{ ok, checks, failures, warnings }`, where each `checks[]` entry is
`{ id, title, status, detail, nextStep }` — for scripting, not for humans.

Every `⚠`/`✖` row that has a fix prints a `→ …` next-step line under it (most
are `npm run …`; `node_version` prints a per-platform install hint, and
`provider_available` prints `Set GEMINI_API_KEY (or
APPLE_DOCS_EMBEDDING_MODEL_PATH) in .env, then run: npm run embed-index`).

`--help` prints the flags without running any check; an unknown flag (for example
`--jsn`) prints usage on stderr and exits `2` instead of silently printing a
normal report.

## Native addon build (better-sqlite3)

`better-sqlite3` is a compiled C++ native addon. If `npm install` fails with `node-gyp` or compiler errors, your system is missing native build tools. This is a local compilation requirement, not an MCP protocol bug.

### macOS

Install the Xcode Command Line Tools:

```bash
xcode-select --install
```

### Debian / Ubuntu

Install standard C++ build utilities and Python:

```bash
sudo apt-get update
sudo apt-get install -y build-essential python3
```

### Fedora / RHEL

```bash
sudo dnf groupinstall "Development Tools"
```

### Verification

Once build tools are installed, rebuild the module:

```bash
npm rebuild better-sqlite3
```
