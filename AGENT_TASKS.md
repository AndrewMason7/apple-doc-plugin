# Agent brief — apple-doc-plugin v1 packaging + honesty pass

You are working in the repo `AndrewMason7/apple-doc-plugin`.

Implement the tasks below. Do not expand scope. Do not rewrite the search engine, DocC formatter, embeddings, or ingest ranking. Do not add WWDC, new MCP tools (except the small `index_info` addition in task 8), or marketing adjectives.

Work in small commits. One logical change per commit. Match existing code style (TypeScript, Prettier, Node native tests).

If a file from this brief is missing or renamed, search the repo and adapt. Do not invent a second package name after you pick one.

---

## Context (do not put this tone in user-facing copy)

The engine is fine. The shop front is not:

- npm `name` / `bin` collide with MightyDillah’s live server `apple-doc-mcp-server`
- `engines` is empty while docs say Node 22+
- README oversold hybrid Gemini as the default personality
- `search_symbols` vs `semantic_search` vs `choose_technology` confuse agents
- `.env` load failures are swallowed
- snapshot freshness is invisible at runtime

A replacement README already exists at `/home/workdir/artifacts/README.md` if that path is available. If it is, use it as the starting point and only patch it if repo facts differ. If it is not available, rewrite `README.md` to match the structure and rules in task 3.

---

## Task 1 — Unique package identity

Files: `package.json`, `plugin.json`, `mcp_config.json`, any bin / launcher references.

1. Change `"name"` from `apple-doc-mcp-server` to `apple-doc-plugin`.
2. Change `"bin"` so the CLI key is `apple-doc-plugin` (value can stay `dist/index.js`).
3. Keep MCP server key as `apple-docs` in client configs (that is the tool namespace users already think in).
4. Grep the repo for `apple-doc-mcp-server` and replace with `apple-doc-plugin` except in the Prior art section, where MightyDillah’s package name must remain accurate.
5. Do not publish to npm as part of this task.

Acceptance:

- `rg apple-doc-mcp-server` only hits prior-art / comparison text, never this package’s name or bin.

---

## Task 2 — `engines` and Node reality

Files: `package.json`, README badge if present.

```json
"engines": {
  "node": ">=22"
}
```

Do not add `engineStrict` unless it already exists.

Acceptance:

- `package.json` engines.node is `>=22`.
- README Node badge still says 22+ and is not lying.

---

## Task 3 — README

File: `README.md` (repo root).

Replace the current README with a version that includes all of the following sections, in this spirit:

1. One-paragraph what it is
2. Two-mode table: Offline (no key) vs Hybrid (Gemini / ADC)
3. Prior art paragraph naming [MightyDillah/apple-doc-mcp](https://github.com/MightyDillah/apple-doc-mcp) and the split: live CDN vs local FTS5 index. This project is a separate codebase, not a drop-in npm alias.
4. Requirements: Node 22+, `better-sqlite3` native compile
5. Install: Antigravity `agy plugin install` + manual MCP JSON using `dist/index.js`
6. Explicit warning: do not `npx apple-doc-mcp-server` and assume it is this repo
7. Tools table with **when to use** each tool (see task 5 decisions)
8. `build:index` as a first-class section (WAL, per-framework CDN pull, optional embeddings, FTS rebuild, `wal_checkpoint(TRUNCATE)`, `VACUUM`)
9. Env vars table (`GEMINI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, `APPLE_DOCS_DB_PATH`) marked optional
10. Limitations: snapshot is not the full corpus; embeddings stale until rebuild; native addon; `choose_technology` optional
11. License MIT © 2026 Andrew Mason

Rules for copy:

- Do not lead with “high-performance” / “sub-millisecond” / “100,000+”
- Use ~99,903 symbols and name the indexed frameworks actually in code
- Keep tone professional. No slang.

Acceptance:

- Prior art is named.
- Offline works without a key is stated in the first screen of the README.
- `build:index` has its own section.

---

## Task 4 — GitHub metadata notes

You cannot set GitHub topics from this repo alone. Add a short `docs/GITHUB.md` (or a “Maintainer notes” blurb at the bottom of README) listing:

- Description to paste: `Offline-first MCP server for Apple Developer Documentation (SQLite FTS5 + optional Gemini hybrid search)`
- Topics: `mcp`, `apple`, `swiftui`, `sqlite`, `documentation`

Do not invent a GitHub Action just for topics.

---

## Task 5 — Tool descriptions (code + schema)

Files: MCP tool registration (likely `src/server/tools.ts`, handlers under `src/server/handlers/`, skill `skills/apple-docs/SKILL.md`, `rules/AGENTS.md`).

Lock this contract:

| Tool                    | Behavior                                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_symbols`        | Lexical only. FTS5 BM25, exact-title boost, wildcards `*` `?`, optional `framework` / `platform` / `symbolType`. Do not call Gemini from this tool.                                 |
| `semantic_search`       | Hybrid. Lexical + vectors + RRF when Gemini/ADC available. If no creds or circuit breaker open, fall back to lexical and say so in the result text.                                 |
| `get_documentation`     | Point lookup. Local SQLite first, Apple DocC CDN fallback. Not a search tool.                                                                                                       |
| `choose_technology`     | Optional session default only. Every search/doc tool already accepts `framework`. Description must say agents should pass `framework` on the call instead of requiring this ritual. |
| `current_technology`    | Read the optional session default.                                                                                                                                                  |
| `discover_technologies` | List/filter frameworks that are actually indexed.                                                                                                                                   |
| `get_version`           | Server version. After task 8, include or defer to `index_info`.                                                                                                                     |

Update:

- MCP `description` strings (this is what models read)
- Skill “mandatory lookup protocol”
- `rules/AGENTS.md`

If `search_symbols` currently runs the Gemini path, move that path so only `semantic_search` uses it. Do not break lexical tests.

Acceptance:

- Tool schema descriptions match the table.
- `search_symbols` unit/e2e tests pass without needing `GEMINI_API_KEY`.
- Skill no longer tells the agent it must `choose_technology` first.

---

## Task 6 — `.env` load must not be silent

File: `src/index.ts` (and any duplicate loader).

Current problem: empty `catch {}` around `process.loadEnvFile`.

Required:

- If `.env` exists and loads: no secret values in logs
- If `.env` missing: one info/stderr line like `No .env found; running offline SQLite mode`
- If `.env` exists but load throws: log the error message (not file contents) and continue in offline mode
- Never print API keys

Acceptance:

- A test in `test/env.test.js` (or adjacent) covers missing vs present `.env` without leaking fixtures.

---

## Task 7 — `choose_technology` schema wording

Even if task 5 is done, verify the JSON schema description for `choose_technology` contains the word `optional` and an example of passing `framework` on `search_symbols` / `semantic_search` / `get_documentation`.

---

## Task 8 — Runtime index metadata

Add a small surface so agents can see snapshot freshness.

Preferred: extend `get_version` rather than adding a new tool, unless extending it would break clients. If you add `index_info`, keep it read-only and trivial.

Must return:

- server version
- db path
- symbol count
- list of indexed frameworks
- snapshot / index built-at timestamp if stored; if not stored, add a `meta` table or `index_meta` row during `build:index` and read it here
- `embeddingsPresent: boolean`

Store metadata when `build:index` runs. Do not fake a date.

Acceptance:

- After a local db open, the tool returns a real count close to the db (not a hardcoded "100000+").
- A unit test opens the shipped db or a fixture and asserts keys exist.

---

## Task 9 — `build:index` operability

File: `scripts/build-index.ts` (and helpers).

Minimum viable, no architecture rewrite:

- Log start/end per framework
- Log whether this run is FTS-only or hybrid
- If a framework fetch fails, log and continue to the next; do not silently skip the final FTS rebuild unless the db is unusable
- At the end, write the metadata from task 8
- Do not add a distributed queue. A simple “continue on framework error” is enough

Acceptance:

- Running the script with a mocked/stubbed client in tests still rebuilds FTS metadata (use existing ingest tests if present; do not hit Apple in CI).

---

## Task 10 — Native addon troubleshooting

Add a short section to README **or** `docs/TROUBLESHOOTING.md`:

- `better-sqlite3` is a native addon
- macOS: Xcode Command Line Tools
- Debian/Ubuntu: `build-essential` + python3
- Symptom: node-gyp / `better-sqlite3` compile errors on `npm install`
- This is not an MCP protocol bug

Keep it under 30 lines.

---

## Task 11 — Single source of truth for indexed frameworks

Find the framework list used by ingest. Extract it to one module (e.g. `src/server/db/frameworks.ts` or existing constant file).

Use that list in:

- `build:index`
- `discover_technologies`
- README “what’s in the snapshot” (generate or copy the names; do not leave README saying frameworks the constant does not include)

Acceptance:

- Grep shows one canonical array/object, not three divergent lists.

---

## Task 12 — Build artifacts

Confirm `dist/` is gitignored. Confirm `data/apple-docs.db` is still intended to be shipped (it is). Do not commit `node_modules`, `.env`, or compiled object files.

If `dist/` is currently tracked, untrack it (`git rm -r --cached dist`) and keep the ignore rule. Do not delete people’s local `dist/` from disk in a destructive way beyond normal git untrack.

---

## Tests

After code changes:

```bash
npm run check
npm test
```

Add/adjust tests for:

- env loader behavior
- tool description contract if you have schema snapshot tests
- `search_symbols` does not require Gemini
- version / index metadata shape
- framework list consistency

Do not delete the stress-tribunal suite to make CI green.

---

## Out of scope

- Rewriting RRF / exact-match boost constants
- Prebuilds for better-sqlite3
- Scheduled snapshot GitHub Action (unless a stub workflow already exists)
- New architecture diagrams
- npm publish
- Renaming MCP tool ids (`search_symbols` stays `search_symbols`)

---

## Done when

- [x] package name/bin unique
- [x] engines.node >=22
- [x] README has prior art, two modes, index refresh, limitations
- [x] tool schemas match lexical vs hybrid split
- [x] choose_technology marked optional
- [x] .env load logs without secrets
- [x] index metadata visible at runtime
- [x] frameworks list is canonical
- [x] dist not tracked
- [x] `npm test` and `npm run check` pass
