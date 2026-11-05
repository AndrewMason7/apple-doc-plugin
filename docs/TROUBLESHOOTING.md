# Troubleshooting

## Start here

Run `npm run doctor` first — it names the failing check and the fix. The table
below maps each check id to the same fix in prose.

| Doctor check              | Symptom                                                                                       | Fix                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `node_version` ✖          | `process.loadEnvFile is not a function`                                                       | Node ≥ 22 (`brew install node`, or `fnm install 22` to pin)                           |
| `database_file` ✖         | `Index file` reports `not found at …`; nothing to search locally                              | `npm run build:index`                                                                 |
| `database_readable` ✖     | `Symbols` reports `database opened but is empty`; every query returns nothing                 | `npm run build:index`                                                                 |
| `fts_index` ✖             | FTS rows ≠ symbol rows; search returns nothing or misses symbols it should match              | `npm run build:index`                                                                 |
| `kind_integrity` ⚠        | a `symbolType` filter silently omits rows whose kind was never classified                     | `npm run repair-index -- --apply`                                                     |
| `attribution_integrity` ⚠ | a framework filter returns another framework's symbol                                         | `npm run repair-index -- --apply`                                                     |
| `provider_available` ⚠    | `none configured` — `semantic_search` behaves like keyword search                             | set `GEMINI_API_KEY` or `APPLE_DOCS_EMBEDDING_MODEL_PATH`, then `npm run embed-index` |
| `semantic_layer` ⚠        | under 100 vectors, so `get_version` reports `Lexical only (SQLite FTS5)`                      | `npm run embed-index`                                                                 |
| `dimension_consistency` ✖ | stored vector width ≠ provider width; cosine scores are meaningless after changing dimensions | `npm run embed-index -- --force`                                                      |
| `snapshot_freshness` ⚠    | snapshot older than 30 days; a new API returns "symbol not found"                             | `npm run build:index`                                                                 |

`✔` is healthy, `⚠` is degraded but working, `✖` is a failure. The run exits `1`
when any check fails; add `--strict` (`npm run doctor -- --strict`) to also exit
`1` on warnings. `npm run doctor -- --json` prints the same rows as
`{ id, title, status, detail, nextStep }` objects for scripting.

Every `✖` row also prints the fixing command under the failing line as
`→ npm run …`, so the CLI alone is usually enough to get back to green.

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
