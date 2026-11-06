# CLI Installer, First-Run Setup, and Cross-Framework Query Expansion Plan

**Goal:** Provide zero-friction onboarding via one-click IDE configuration (`install`), vector bootstrapping and system verification (`setup`), and intelligent cross-framework query expansion (`query-expansion.ts`) mapping Web, React, and Android idioms into Apple native symbols within hybrid search.

---

## Architecture & Components

### 1. One-Click IDE / Agent Configuration CLI (`installer.ts` & `installer-cli.ts`)

- **Supported Targets:** `cursor`, `claude-desktop` (alias `claude`), `windsurf`, `antigravity`, `vscode`.
- **Platform Resolution:** Resolves config paths across macOS (`darwin`), Windows (`win32`), and Linux (`linux`). Uses platform-aware path joiners (`path.win32` vs `path.posix`).
- **Resilient Config Manipulation:** State-machine comment & trailing-comma stripper (`cleanJsonComments`) that safely preserves URLs (`https://...`) and string content. Non-destructive merge into existing `mcpServers` object, automatic backup generation (`.bak`), dry-run preview, and `--env` flag support.

### 2. First-Run Setup & Vector Bootstrap CLI (`setup.ts` & `setup-cli.ts`)

- **Health & Diagnostic Inspection:** Verifies database presence, symbol counts, vector dimensions, and local EmbeddingGemma model status.
- **Provider & Auth Detection:** Detects local GGUF model and Gemini authentication (API key and Application Default Credentials ADC).
- **Bootstrapping Actions:** Integrates automated downloading of 768-d precomputed vectors and local Gemma GGUF model, plus optional IDE configuration. Supports `--dry-run`, `--strict`, and `--json`.

### 3. Cross-Framework Query Expansion Layer (`query-expansion.ts` & `hybrid-search.ts`)

- **Curated Idiom Dictionary:** Maps 18+ cross-framework concepts across React (`useEffect`, `useState`, `useContext`, `useMemo`, `Redux`, `AsyncStorage`), Web (`Flexbox`, `CSS Grid`, `localStorage`, `onClick`), and Android (`SharedPreferences`, `coroutine`, `Room`, `ViewModel`, `RecyclerView`, `WorkManager`, `Toast`).
- **Precision Matching:** Regex escaping with word boundary guards; avoids broad generic words (`service`, `navigation`, `preferences`) to prevent false positives on native Apple concepts.
- **Hybrid Search Integration:** Injects mapped candidate symbols into lexical candidate pool with boost, and enriches vector search query prompts for semantic alignment.

---

## Verification & Test Plan

1. **Unit Tests:**
   - `test/query-expansion.test.js`: Idiom parsing, precision matching, boundary checks, no false positives on generic terms.
   - `test/hybrid-search-expansion.test.js`: End-to-end symbol discovery with query expansion and disable toggle.
   - `test/installer.test.js`: Cross-platform path resolution, comment stripping preserving URLs, backup creation, merge idempotency, CLI flags (`--target`, `--dry-run`, `--json`, `--env`).
   - `test/setup.test.js`: Missing/initialized db reports, dry-run flags, CLI execution.
   - `test/cli-launcher.test.js`: Top-level CLI subcommands and help texts.
2. **Quality Gates:**
   - 100% clean TypeScript build (`tsc --noEmit`).
   - Prettier formatting compliance (`prettier --check .`).
   - All Node.js tests passing (`npm test`).
   - Python tests passing (`pytest test/`).
