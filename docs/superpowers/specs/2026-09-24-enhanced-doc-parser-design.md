# Enhanced DocC AST Parser & Rich Documentation Design Spec

**Date:** 2026-09-24  
**Author:** Antigravity  
**Status:** Approved for Implementation

---

## 1. Problem Statement

When an AI assistant (such as Cursor, Claude Code, or Antigravity) queries Apple Developer Documentation using `get_documentation`, the current implementation only outputs a high-level title, technology name, platform string, and a 1-sentence abstract.

Crucial technical details required to write correct Swift code are discarded:

1. **Swift Declarations & Signatures**: Full function, struct, protocol, and initializer declarations (including generics, parameter labels, default arguments, and return types) are contained in `primaryContentSections` of kind `declarations` but never formatted.
2. **Parameters & Return Types**: Parameter documentation (`primaryContentSections` of kind `parameters`) is ignored.
3. **Deprecation Notices & Modern Replacements**: Apple's `deprecationSummary` explicitly specifies why an API was deprecated and which modern API replaces it (e.g. using `NavigationStack` instead of `NavigationView`), but this is omitted.
4. **Rich Discussion & Code Examples**: Apple's official runnable Swift code examples and architectural notes reside in `primaryContentSections` of kind `content` (`codeListing`, `paragraph`, `aside`), but are currently dropped.
5. **Stateful Tool Overhead**: `get_documentation` requires the agent to either know the full path or have called `choose_technology` beforehand. Adding an optional `framework` parameter to `get_documentation` makes it 100% stateless and ergonomic.

---

## 2. Requirements & Goals

### Functional Requirements

1. **Swift Declaration Formatting**:
   - Extract `primaryContentSections` where `kind === "declarations"`.
   - Concatenate tokens (`tokens.map(t => t.text).join('')`).
   - Wrap in a syntax-highlighted Swift code fence (` ```swift ... ``` `).
2. **Deprecation Alert**:
   - Extract `deprecationSummary` (if present and non-empty).
   - Convert inline tokens (`text`, `codeVoice`, `reference`) into formatted markdown.
   - Render as a prominent GitHub-style warning alert:
     ```markdown
     > [!WARNING]
     > **Deprecated**: Use `NavigationStack` and `NavigationSplitView` instead.
     ```
3. **Parameters Section**:
   - Extract `primaryContentSections` where `kind === "parameters"`.
   - List each parameter with its name as code and its formatted description:

     ```markdown
     ### Parameters

     - `titleResource`: A localized string that describes the view...
     ```

4. **Discussion & Code Examples**:
   - Extract `primaryContentSections` where `kind === "content"`.
   - Format headings (`##`), paragraphs, code listings (` ```swift ... ``` `), unordered/ordered lists, and asides (`> [!NOTE]`).
5. **Stateless `get_documentation`**:
   - Accept optional `framework` parameter in `get_documentation` schema.
   - If provided, construct `documentation/${framework}/${path}` candidate paths immediately without relying on `state.getActiveTechnology()`.
6. **Graceful Offline Fallback**:
   - If the network fails or symbol is not reachable on Apple CDN, gracefully return the SQLite cached metadata as before.

---

## 3. Architecture & Separation of Concerns

```
src/
├── apple-client/
│   ├── types/
│   │   └── index.ts            <-- Add DocC token, declaration, param, content types
│   ├── docc-formatter.ts       <-- Dedicated pure transformation functions (SoC)
├── server/
│   ├── handlers/
│   │   └── get-documentation.ts <-- Uses docc-formatter; supports framework argument
│   └── tools.ts                <-- Exposes framework arg in inputSchema
test/
└── docc-formatter.test.js      <-- Comprehensive unit test suite
```

### Module Responsibilities

- `docc-formatter.ts`: Pure parser/formatter functions with zero I/O and zero external network side-effects. Converts DocC AST JSON structures into clean GitHub Flavored Markdown.
- `get-documentation.ts`: Coordinates symbol resolution, error handling, session state fallback, and invokes `docc-formatter`.
- `tools.ts`: Defines MCP tool metadata and parameter validation schemas.
