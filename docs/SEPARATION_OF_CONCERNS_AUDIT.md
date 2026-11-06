# Separation of Concerns (SoC) Architectural Audit

**Repository**: `apple-doc-plugin`  
**Date**: November 6, 2026  
**Auditor**: Antigravity Autonomous Engineering Agent  
**Status**: Passed / Fully Compliant

---

## 1. Executive Summary

This audit establishes, enforces, and documents the architectural boundaries and Separation of Concerns (SoC) across the `apple-doc-plugin` codebase. Prior iterations contained minor layer leaks, including CLI option parsing and terminal formatting placed inside `src/server/services/*-cli.ts`, Python bridge files polluting the repository root, flat unstructured test hierarchies, and duplicated client entry points.

This refactoring eliminates all architectural violations, establishing five strictly decoupled layers with unidirectional dependencies, headless service logic, dedicated CLI commands and routing, canonical client namespaces, isolated external bridges, and categorized test suites.

```
┌────────────────────────────────────────────────────────┐
│             Presentation & Bridges Layer               │
│   src/cli/ (Commands & Router)  │  bridges/hermes/     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                    Transport Layer                     │
│  src/server/app.ts  │  src/server/handlers/ (MCP)      │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                    Services Layer                      │
│   Headless Business Logic: search/, doctor.ts,         │
│   installer.ts, setup.ts, xcode-indexer.ts,            │
│   download-model.ts, download-vectors.ts               │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│              Domain & Persistence Layer                │
│   src/server/db/ (AppleDocsDB, SQLite FTS5, vec)       │
│   src/apple-client/ (HttpClient, FileCache, DocC)      │
└────────────────────────────────────────────────────────┘
```

---

## 2. Layer Boundaries & Architectural Rules

### Layer 1: Presentation (`src/cli/`)

- **Location**: `src/cli/commands/`, `src/cli/router.ts`
- **Responsibilities**:
  - Command-line argument parsing (`argv`), flag validation, and `--help` usage documentation.
  - Interactive terminal progress indicators, ANSI styling, and human-readable formatting.
  - JSON output formatting (`--json`) and process exit code resolution (0 for success, 1 for operational failures, 2 for invalid flags).
- **Prohibited**:
  - Direct database execution, SQL queries, or network HTTP calls. Must delegate all operations to the Services layer.
  - MCP protocol serialization or stdio JSON-RPC handling.
- **Audited Components**:
  - `src/cli/router.ts`: Master CLI dispatcher routing subcommands (`doctor`, `setup`, `install`, `index-xcode`, `download-vectors`, `download-model`, `export-vectors`) or yielding to stdio server mode.
  - `src/cli/commands/doctor.ts`: Health check terminal reporter.
  - `src/cli/commands/install.ts`: Multi-IDE configuration interactive runner.
  - `src/cli/commands/setup.ts`: First-run onboarding wizard.
  - `src/cli/commands/xcode-indexer.ts`: Offline `.doccarchive` batch importer CLI.
  - `src/cli/commands/download-model.ts`, `download-vectors.ts`, `export-vectors.ts`: Asset transfer CLIs.

### Layer 2: Transport & Protocol (`src/server/`)

- **Location**: `src/server/app.ts`, `src/server/handlers/`, `src/server/tools.ts`, `src/server/prompts.ts`, `src/server/resources.ts`
- **Responsibilities**:
  - MCP (Model Context Protocol) JSON-RPC 2.0 lifecycle management via `@modelcontextprotocol/sdk`.
  - Request schema validation and tool call parameter extraction.
  - Formatting domain outputs into LLM-optimized Markdown, tables, code blocks, and diagrams.
- **Prohibited**:
  - Calling `process.exit()`, reading `process.argv`, or writing unformatted text directly to `process.stdout`/`process.stderr`.
  - Coupling with terminal styling or CLI flags.
- **Audited Components**:
  - `src/server/app.ts`: MCP server factory and tool/prompt/resource attachment.
  - `src/server/handlers/search-symbols.ts`: Adapts FTS5 queries and wildcard matches.
  - `src/server/handlers/get-documentation.ts`: Adapts local and CDN documentation retrievals.
  - `src/server/handlers/discover.ts`: Adapts framework discovery and pagination.
  - `src/server/handlers/version.ts`: Adapts index metadata and version reporting.

### Layer 3: Services (Headless Domain Logic)

- **Location**: `src/server/services/`
- **Responsibilities**:
  - Pure headless orchestration of business algorithms, search engines, and index maintenance.
  - Hybrid search fusion: Reciprocal Rank Fusion (RRF), cross-framework query expansion, and circuit-breaker management.
  - Headless health analysis (`doctor.ts`), IDE configuration writing (`installer.ts`), environment assessment (`setup.ts`), and DocC archive indexing (`xcode-indexer.ts`).
  - Headless asset distribution: vector download pipeline, SHA-256 validation, mirror failover, and standalone SQLite packaging.
- **Prohibited**:
  - Terminal output formatting, ANSI codes, and process termination (`process.exit`).
  - Progress updates must use injected callbacks (`onProgress?: (progress: ProgressInfo) => void`) rather than writing to stdout/stderr.
- **Audited Components**:
  - `src/server/services/search/`: Pure vector/lexical engines (`hybrid-search.ts`, `semantic-search.ts`, `local-gemma-provider.ts`, `query-expansion.ts`, `retry.ts`).
  - `src/server/services/doctor.ts`: Pure health evaluator returning typed `DoctorReport`.
  - `src/server/services/installer.ts`: Pure config generation and filesystem patching returning typed `InstallResult`.
  - `src/server/services/setup.ts`: Pure state determination returning typed `SetupReport`.
  - `src/server/services/xcode-indexer.ts`: Pure DocC archive parser returning typed `IndexXcodeResult`.

### Layer 4: Domain & Persistence (`src/server/db/` & `src/apple-client/`)

- **Location**: `src/server/db/`, `src/apple-client/`
- **Responsibilities**:
  - `src/server/db/`: Encapsulates SQLite database connection, table schemas, FTS5 inverted index BM25 querying, and `sqlite-vec` vector similarity search.
  - `src/apple-client/`: Encapsulates Apple Developer Documentation CDN communication (`HttpClient`), two-tier atomic disk/memory caching (`FileCache`, `MemoryCache`), DocC AST parsing, and official TypeScript declarations.
- **Prohibited**:
  - Awareness of MCP protocols, prompt templates, or CLI arguments.
  - Leaking raw SQL error crashes to higher layers (all errors sanitized or wrapped in typed error hierarchy).
- **Audited Components**:
  - `src/server/db/database.ts`: Canonical `AppleDocsDB` class.
  - `src/apple-client/index.ts`: Canonical `AppleDevDocsClient` class.
  - `src/apple-client.ts`: Backward-compatible root facade re-exporting `src/apple-client/index.ts`.

### Layer 5: Agent Bridges (`bridges/`)

- **Location**: `bridges/hermes/`
- **Responsibilities**:
  - Polyglot integration providing native Python SDK support for Hermes Agent.
  - Subprocess lifecycle management (`NodeMcpBridge`), JSON-RPC 2.0 communication over stdio, deadlock-free non-blocking stdout/stderr readers, and fast-fail crash detection.
  - Python tool registration (`register(ctx)`) for both `@ctx.tool` decorator and `ctx.register_tool` method semantics.
- **Prohibited**:
  - Polluting repository root with bridge scripts.
  - Bypassing the standard MCP transport or mutating TypeScript source files.
- **Audited Components**:
  - `bridges/hermes/hermes_bridge.py`: Python MCP bridge client.
  - `bridges/hermes/__init__.py`: Tool declarations and Hermes context registration.

---

## 3. Test Suite Taxonomy & Segregation

The test suite has been restructured from a flat 68-file directory into four distinct categories matching the architectural layers:

| Directory           | Scope                                                  | Test Count           | Key Test Suites                                                                                                                                                   |
| ------------------- | ------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/unit/`        | Isolated algorithmic, database, and domain logic       | 45 files (200 tests) | `db.test.js`, `fts-integrity.test.js`, `sqlite-vec.test.js`, `query-expansion.test.js`, `doctor.test.js`, `docc-formatter.test.js`, `adc-auth.test.js`            |
| `test/cli/`         | Command-line parsing, options, and terminal formatting | 8 files (44 tests)   | `cli-launcher.test.js`, `doctor-cli.test.js`, `installer.test.js`, `setup.test.js`, `xcode-indexer.test.js`, `export-vectors.test.js`, `download-helpers.test.js` |
| `test/integration/` | End-to-end MCP protocol, handlers, and binary builds   | 10 files (39 tests)  | `mcp-protocol.test.js`, `mcp-handlers.test.js`, `mcp-prompts.test.js`, `mcp-resources.test.js`, `packaging.test.js`, `stress-tribunal.test.js`, `e2e.test.js`     |
| `test/python/`      | Python Hermes SDK bridge, manifests, and resilience    | 5 files (8 tests)    | `test_hermes_bridge.py`, `test_hermes_manifest.py`, `test_hermes_registration.py`, `test_hermes_resilience.py`, `test_hermes_e2e.py`                              |

---

## 4. Verification Matrix

| Verification Check          | Target                            | Command                                                | Result                                          |
| --------------------------- | --------------------------------- | ------------------------------------------------------ | ----------------------------------------------- |
| **TypeScript Compilation**  | Whole codebase                    | `tsc --noEmit`                                         | **0 errors (Pass)**                             |
| **Code Style & Formatting** | Whole codebase                    | `prettier --check .`                                   | **All matched files use Prettier style (Pass)** |
| **Node.js Test Suite**      | 63 files (unit, cli, integration) | `node --test test/**/*.test.js`                        | **283 passed, 0 failed, 0 skipped**             |
| **Python Test Suite**       | 5 files (Hermes bridge)           | `pytest test/python/`                                  | **8 passed, 0 failed, 0 skipped**               |
| **All Test Suites**         | Node.js + Python                  | `npm run test:all`                                     | **291 total tests passed (100%)**               |
| **CLI Binary Entrypoint**   | Native launcher                   | `bin/apple-doc-plugin-native --help`                   | **Pass (0 exit code)**                          |
| **CLI Subcommand: Doctor**  | System diagnostic                 | `node dist/index.js doctor`                            | **Pass (0 exit code)**                          |
| **CLI Subcommand: Setup**   | First-run onboarding              | `node dist/index.js setup --dry-run`                   | **Pass (0 exit code)**                          |
| **CLI Subcommand: Install** | IDE configuration                 | `node dist/index.js install --target cursor --dry-run` | **Pass (0 exit code)**                          |
