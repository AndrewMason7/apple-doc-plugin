# Apple Docs Desktop UI Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate visual overload in `desktop/plugin.js` by turning `AppleDocsSidePane` into a single-purpose Quick Lookup pane and decluttering `AppleDocsStudioPage` using native `@hermes/plugin-sdk` controls.

**Architecture:** Keep all `@hermes/plugin-sdk` strict invariants (uncompiled ESM `jsx()`, only 3 allowed imports, `var(--ui-*)` theme tokens, 2 panes so closing one never disables the plugin, React Query cache). Replace cramped multi-tab/multi-pill layouts with a focused master/detail flow in the 380px side pane and native `Tabs`, `SearchField`, `Select*`, and `EmptyState` components in the full Studio page.

**Tech Stack:** `@hermes/plugin-sdk` (`Tabs`, `TabsList`, `TabsTrigger`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SearchField`, `EmptyState`, `useQuery`), React (`react`, `react/jsx-runtime`), `node:test`.

**Spec:** User-approved Option 1 (Smart Simplification) from brainstorming in this session.

## Global Constraints

- Only import `@hermes/plugin-sdk`, `react`, and `react/jsx-runtime` in `desktop/plugin.js`.
- Write UI exclusively with `jsx()` / `jsxs()` / `Fragment` (zero JSX syntax).
- Never hardcode `#hex`, `rgb(...)`, or `hsl(...)` colors; use `var(--ui-*)` tokens.
- Keep `2` registered panes (`inspector-pane` and `compiler-pane`) so closing one pane dismisses rather than disables the plugin.
- Every capitalized component in `jsx()`/`jsxs()` must be imported or declared in `desktop/plugin.js`.

## Review Focus

- **Empty search results:** Typing a query with zero matches must render `EmptyState` cleanly instead of a blank box or crash.
- **Framework `Select` reset:** Selecting `"__all__"` (All Frameworks) must clear `framework` / `frameworkFilter` to `""` so global search resumes.
- **380px side-pane drill-down:** Clicking a symbol in `AppleDocsSidePane` must switch cleanly to the DocC detail view with a `← Results` back button, never squishing list + full docs vertically.
- **Pane close survival:** `compiler-pane` remains registered even after removing the `Xcode` tab from `AppleDocsSidePane`.
- **i18n + React Query cache:** `AppleDocsSidePane` and `AppleDocsStudioPage` continue sharing `[PLUGIN_ID, 'search', ...]` and `[PLUGIN_ID, 'doc', ...]` query keys.

---

### Task 1: Simplify `AppleDocsSidePane` into a focused Quick Lookup pane

**Files:**

- Modify: `desktop/plugin.js:1903-2330`
- Test: `test/unit/desktop-plugin.test.js`

**Interfaces:**

- Consumes: `SearchField`, `Select`, `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `EmptyState` from `@hermes/plugin-sdk`; `fetchPluginSearch`, `fetchPluginDoc`, `useDebouncedValue`, `insertIntoChatComposer` in `desktop/plugin.js`.
- Produces: `AppleDocsSidePane({ ctx })` rendering single-purpose Quick Lookup (Search + Framework `Select` + `Semantic`/`Lexical` toggle + Results list OR drill-down `SymbolInspectorDetail` with `← Results`).

- [ ] **Step 1: Add render & declutter assertions to `test/unit/desktop-plugin.test.js`**

Update `mock://sdk` and `globalThis.__SDK_EXPORTS__` in `test/unit/desktop-plugin.test.js` to include `EmptyState`, `SearchField`, `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`, `Tabs`, `TabsList`, `TabsTrigger`, and add a test asserting `inspector-pane` renders without throwing when `render()` is invoked.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/unit/desktop-plugin.test.js`
Expected: FAIL because the new UI kit exports are not yet imported in `desktop/plugin.js` / mocked in the test.

- [ ] **Step 3: Refactor `AppleDocsSidePane` in `desktop/plugin.js`**

1. Import `EmptyState`, `SearchField`, `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue`, `Tabs`, `TabsList`, `TabsTrigger` from `@hermes/plugin-sdk`.
2. In `AppleDocsSidePane({ ctx })`, remove `activeTab`, `idiomFilter`, `idiomQ`, `idiomsQuery`, and the `Idioms` / `Xcode` tabs (keep a single `Studio ↗` button in the header to reach Idioms/Frameworks).
3. Replace the 9 framework filter `<button>` pills with a compact `<Select value={framework || '__all__'} onValueChange={(v) => setFramework(v === '__all__' ? '' : v)}>` dropdown.
4. When `selectedSymbol` is `null`, render the `ScrollArea` of search results (or `<EmptyState>` when empty); when `selectedSymbol` is set, render a `← Results` `Button` bar + the symbol detail card so the 380px pane is never vertically crushed.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/unit/desktop-plugin.test.js`
Expected: PASS

---

### Task 2: Declutter `AppleDocsStudioPage` (`/apple-docs`)

**Files:**

- Modify: `desktop/plugin.js:1115-1895`
- Test: `test/unit/desktop-plugin.test.js`

**Interfaces:**

- Consumes: `Tabs`, `TabsList`, `TabsTrigger`, `SearchField`, `Select*`, `EmptyState` from `@hermes/plugin-sdk`.
- Produces: Cleaner `AppleDocsStudioPage({ ctx })` without the top accent banner, without redundant header badges, and with `Select` + `Tabs` + `SearchField`.

- [ ] **Step 1: Add Studio page render check in `test/unit/desktop-plugin.test.js`**

Invoke the `studio-route` contribution's `render()` in `test/unit/desktop-plugin.test.js` and assert it returns a valid element tree without throwing.

- [ ] **Step 2: Run test to verify baseline / check**

Run: `node --test test/unit/desktop-plugin.test.js`

- [ ] **Step 3: Declutter `AppleDocsStudioPage` in `desktop/plugin.js`**

1. Remove the top accent banner (`Viewing Full Studio. Prefer Apple Docs docked side-by-side...`).
2. Simplify the header to title + 1 status badge (`apiLive` / offline) + `Side Pane` and `← Chat` buttons.
3. Replace the raw `<button>` tab strip with `<Tabs value={activeTab} onValueChange={setActiveTab}><TabsList>...</TabsList></Tabs>`.
4. In the `explorer` tab, replace the 9-pill framework wrap row with a `<Select>` dropdown (`All Frameworks` + frameworks list), use `<SearchField>` for the search input, and render `<EmptyState>` when `results.length === 0`.

- [ ] **Step 4: Run tests and Prettier/TypeScript checks**

Run: `npx prettier --write desktop/plugin.js test/unit/desktop-plugin.test.js && npm run check && npm test`
Expected: `All matched files use Prettier code style!`, `402+` passing, `0` failing.

---

### Task 3: Sync to VPS & Mac, Commit, and Push

**Files:**

- Sync: `~/.hermes/plugins/apple-doc-plugin/desktop/plugin.js`, `~/.hermes/desktop-plugins/apple-doc-plugin/plugin.js`, and `andrew@100.69.249.98` equivalents.

- [ ] **Step 1: Sync `desktop/plugin.js` to VPS and Mac and verify SHA-256 parity**

Run `cp` + `scp` + `sha256sum` / `ssh ... shasum -a 256` and confirm all 5 copies have identical hashes.

- [ ] **Step 2: Commit and push to `origin/main`**

```bash
git add desktop/plugin.js test/unit/desktop-plugin.test.js docs/superpowers/plans/2026-11-13-desktop-ui-declutter.md
git commit -m "refactor(desktop): declutter side pane and studio page with native SDK controls"
git push origin main
```
