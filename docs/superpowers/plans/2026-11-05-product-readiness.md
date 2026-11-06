# Product Readiness Implementation Plan: Distribution, Semantic Search, Frameworks, and MCP Integration

**Goal:** Transform apple-doc-plugin into a production-ready, zero-friction developer product with instant distribution, out-of-the-box local semantic search, comprehensive framework coverage, and deep MCP protocol integration (resources, prompts, concise mode, fuzzy typo suggestions).

---

## Task Breakdown

### Phase 1: Expanded Framework Coverage (TDD)

- [ ] Update `src/server/db/frameworks.ts` with 13 new high-demand frameworks:
      `StoreKit`, `WidgetKit`, `AuthenticationServices`, `LocalAuthentication`, `Security`, `AVFoundation`, `AVKit`, `UserNotifications`, `MapKit`, `RealityKit`, `Vision`, `CoreData`, `WebKit`.
- [ ] Update `CANONICAL_SLUGS` in `src/server/db/path-attribution.ts` for all 21 frameworks.
- [ ] Update `FRAMEWORK_DEFAULT_PLATFORMS` in `src/server/services/indexer.ts` for all 21 frameworks.
- [ ] Update `test/frameworks.test.js` to assert the 21 frameworks.
- [ ] Verify test suite passes (`npm test`).

### Phase 2: Deep MCP Protocol Integration (TDD)

- [ ] Implement Levenshtein distance utility `src/server/services/levenshtein.ts` and fuzzy suggestion helper `findFuzzySuggestions` in `src/server/db/database.ts` or `src/server/services/symbol-resolution.ts`.
- [ ] Implement `concise: boolean` option in `get_documentation` (`src/server/tools.ts`, `src/server/handlers/get-documentation.ts`).
- [ ] Add fuzzy suggestions to unresolved error output in `get_documentation`.
- [ ] Implement MCP Resources:
  - Add `resources: {}` to server capabilities in `src/server/app.ts`.
  - Implement `src/server/resources.ts` with `ListResourcesRequestSchema`, `ListResourceTemplatesRequestSchema`, `ReadResourceRequestSchema`.
  - Support `apple-docs://frameworks` and `apple-docs://symbols/{framework}`.
- [ ] Implement MCP Prompts:
  - Add `prompts: {}` to server capabilities in `src/server/app.ts`.
  - Implement `src/server/prompts.ts` with `ListPromptsRequestSchema`, `GetPromptRequestSchema`.
  - Support `modernize-navigation`, `scaffold-swiftdata`, `audit-deprecation`.
- [ ] Register resources and prompts in `src/server/app.ts`.
- [ ] Write unit tests for resources, prompts, concise mode, and fuzzy typo suggestions in `test/mcp-resources.test.js`, `test/mcp-prompts.test.js`, and `test/get-documentation-concise-fuzzy.test.js`.
- [ ] Verify all tests pass (`npm test`).

### Phase 3: Out-of-the-Box Semantic Search Helpers

- [ ] Implement automated GGUF model download helper `src/server/services/download-model.ts` and script `scripts/download-model.ts`.
  - Downloads `embeddinggemma-2-Q8_0.gguf` from Hugging Face with progress and checksum/size verification.
- [ ] Implement pre-computed vector asset downloader helper `src/server/services/download-vectors.ts` and script `scripts/download-vectors.ts`.
  - Downloads pre-computed vector DB / asset and merges into `apple-docs.db` `semantic_items` table.
- [ ] Write unit tests for `download-model` and `download-vectors` in `test/download-helpers.test.js`.
- [ ] Verify test suite passes (`npm test`).

### Phase 4: Zero-Friction Distribution & Launcher

- [ ] Update `src/index.ts` to support subcommands:
  - `doctor` -> invokes `runDoctorCli`
  - `download-vectors` -> invokes vector downloader
  - `download-model` -> invokes GGUF model downloader
  - default -> starts MCP server over stdio
- [ ] Update `bin/launcher.cjs` to handle resilient fallback and argument passing.
- [ ] Ensure SQLite driver failure fallback is completely resilient: if native bindings fail, `app.ts` falls back to dynamic DocC mode without crashing.
- [ ] Update `package.json` scripts, `bin`, `files`, and description if necessary.
- [ ] Write tests in `test/cli-launcher.test.js` verifying subcommands and native SQLite fallback behavior.
- [ ] Run `npm run check` and `npm test` to ensure 100% clean build, formatting, and passing test suite.
