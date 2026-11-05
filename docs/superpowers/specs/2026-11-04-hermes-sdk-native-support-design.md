# Design Document: Native Hermes Agent SDK Support for Apple Doc Plugin

**Date:** 2026-11-04  
**Author:** Andrew Mason  
**Status:** Pending Approval

---

## 1. Intent & Context

`apple-doc-plugin` currently serves as an offline-first MCP server and Antigravity plugin for Apple Developer Documentation. It provides fast SQLite FTS5 lexical matching, DocC markdown extraction, and hybrid vector search over 65,000+ Apple APIs.

Hermes Agent (by Nous Research) features a native plugin architecture with an official [Plugin Catalog](https://hermes-agent.nousresearch.com/docs/user-guide/features/plugin-catalog) (`hermes plugins install <name-or-git-url>`). To make this plugin directly installable and usable in Hermes Agent without sacrificing Antigravity or standard MCP support, we are introducing native Hermes SDK integration.

---

## 2. Goals & Non-Goals

### Goals

- **Dual Compatibility:** Ensure the repository works seamlessly as both an Antigravity plugin (`plugin.json`), a standard MCP server (`mcp_config.json`), and a native Hermes Agent plugin (`plugin.yaml` + `__init__.py`).
- **Catalog-Ready Manifest:** Provide a compliant `plugin.yaml` (Manifest v2) containing rich metadata, tags, capabilities, documentation links, and external dependency hints (`node >= 22`).
- **Zero Logic Duplication:** Keep the Node.js TypeScript engine as the single source of truth for DocC formatting, SQLite FTS5 queries, and vector embeddings.
- **High-Performance Stdio MCP Bridge:** Maintain a persistent Node child process managed via Python stdio JSON-RPC, delivering sub-millisecond tool lookups without cold-start penalties.
- **Robust Tool Registration:** Support both `ctx.register_tool(...)` and `@ctx.tool(...)` paradigms to handle varying versions of the Hermes Agent runtime context.
- **Clean Lifecycle Management:** Guarantee proper child process termination on agent exit (`atexit`, signal handling).
- **Automated Verification:** Include a test script (`test/test_hermes_plugin.py`) validating the Hermes plugin registration and end-to-end tool execution against a mock Hermes context.

### Non-Goals

- Rewriting the search algorithms, SQLite FTS5 queries, or DocC parsers in pure Python.
- Modifying existing Antigravity `plugin.json` or breaking standalone MCP clients.
- Introducing heavy Python third-party dependencies; the Python bridge must rely strictly on the Python standard library (`subprocess`, `threading`, `json`, `sys`, `pathlib`, `atexit`).

---

## 3. Constraints & Dependencies

- **Node.js Runtime:** Requires `node >= 22` installed on the host system to run `bin/launcher.cjs`.
- **Python Environment:** Compatible with Python 3.10+ using only standard library packages.
- **Hermes Agent Runtime:** Compatible with Hermes Agent Manifest v2 and context registration APIs (`register(ctx)`).

---

## 4. Approaches Considered

| Approach                                        | Description                                                                                                                           | Trade-offs                                                                                                                                            | Decision                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Approach 1: Persistent Stdio MCP Bridge**     | Python `__init__.py` lazily launches `node bin/launcher.cjs` as a persistent subprocess and communicates over stdio via JSON-RPC 2.0. | **Pros:** Zero code duplication; warm cache & DB connection; sub-millisecond responses.<br>**Cons:** Requires process lifecycle management in Python. | **Selected** (Recommended) |
| **Approach 2: One-Shot CLI Execution**          | Python `__init__.py` spawns a fresh `node` subprocess per tool call.                                                                  | **Pros:** Stateless.<br>**Cons:** 150–250ms latency overhead per query; cannot keep in-memory vector models warm.                                     | **Rejected**               |
| **Approach 3: Pure Python SQLite/DocC Rewrite** | Reimplement SQLite FTS5 search and DocC CDN fetching natively in Python.                                                              | **Pros:** No Node dependency.<br>**Cons:** High maintenance divergence and duplication of complex DocC markdown formatting.                           | **Rejected**               |

---

## 5. Technical Specification

### 5.1 Manifest Specification (`plugin.yaml`)

```yaml
name: apple-doc-plugin
label: Apple Developer Documentation
version: 1.0.0
manifest_version: 2
api_version: 1
author: Andrew Mason <https://github.com/AndrewMason7>
license: MIT
homepage: https://github.com/AndrewMason7/apple-doc-plugin
repository: https://github.com/AndrewMason7/apple-doc-plugin.git
description: >
  Instant offline access to 65,000+ Apple Developer Documentation symbols with
  smart SQLite FTS5 search, wildcard matching, multimodal UI layout previews,
  and DocC markdown extraction.
tags:
  - apple
  - ios
  - macos
  - swiftui
  - swift
  - documentation
  - mcp
platforms:
  - macos
  - linux
external_dependencies:
  - name: node
    install_hint: 'Node.js >= 22 is required. Install via brew install node or fnm install 22.'
provides_tools:
  - search_symbols
  - semantic_search
  - get_documentation
  - discover_technologies
  - get_version
  - index_info
```

### 5.2 Python Bridge Architecture (`__init__.py` & `hermes_bridge.py`)

- **`NodeMcpBridge` class:**
  - Singleton pattern / lazy process initialization.
  - Spawns `node bin/launcher.cjs` on the first tool invocation.
  - Sends JSON-RPC `initialize` handshake and captures initialized state.
  - Coordinates asynchronous response resolution via thread-safe message correlation ID (`id: 1, 2, ...`).
  - Registers cleanup on `atexit` to terminate the Node process cleanly.
- **Tool Registration (`register(ctx)`):**
  - Defines schemas matching the MCP tool signatures for:
    - `search_symbols(query, framework?, platform?, symbolType?, maxResults?)`
    - `semantic_search(query, framework?, platform?, symbolType?, maxResults?)`
    - `get_documentation(path, framework?)`
    - `discover_technologies(query?, page?, pageSize?)`
    - `get_version()`
    - `index_info()`
  - Handlers execute `bridge.call_tool(tool_name, arguments)` and return formatted text strings directly into Hermes conversation context.

### 5.3 Automated Verification

- Script `test/test_hermes_plugin.py`:
  - Simulates Hermes Agent runtime context (`MockContext`).
  - Invokes `register(mock_ctx)`.
  - Executes test queries (`get_version`, `search_symbols(query='NavigationStack')`, `get_documentation(path='NavigationStack', framework='SwiftUI')`).
  - Verifies structured JSON/text output and validates child process cleanup.

---

## 6. What's Left to Implementation

- Create `plugin.yaml` with catalog metadata.
- Implement `hermes_bridge.py` and `__init__.py`.
- Create and run `test/test_hermes_plugin.py` to confirm zero regressions.
- Update `README.md` with Hermes installation instructions (`hermes plugins install ...`).
