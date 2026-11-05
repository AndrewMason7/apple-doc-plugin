# Native Hermes Agent SDK Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native Hermes Agent SDK support and Plugin Catalog metadata to `apple-doc-plugin` using a persistent stdio MCP bridge.

**Architecture:** A root `plugin.yaml` manifest defines Hermes Manifest v2 metadata and declared tools. A Python entrypoint (`__init__.py`) and bridge (`hermes_bridge.py`) implement Hermes `register(ctx)` to register the 6 documentation tools, lazily spawning `node bin/launcher.cjs` and communicating via standard MCP JSON-RPC over stdio.

**Tech Stack:** Python 3.10+ (Standard Library: `subprocess`, `json`, `threading`, `atexit`, `pathlib`), YAML (`plugin.yaml`), Node.js 22+ (`bin/launcher.cjs`), pytest / unittest.

**Spec:** `docs/superpowers/specs/2026-11-04-hermes-sdk-native-support-design.md`

## Global Constraints

- Must preserve 100% backward compatibility with Antigravity (`plugin.json`, `mcp_config.json`) and standalone MCP hosts.
- Zero third-party Python dependencies; standard library only (`subprocess`, `json`, `threading`, `atexit`, `sys`, `pathlib`).
- Single source of truth: all search, DocC formatting, and database queries remain in the Node.js TypeScript engine (`bin/launcher.cjs`).
- Node process must be started lazily and terminated cleanly on process exit (`atexit` and signal handlers).
- Must declare `external_dependencies` in `plugin.yaml` indicating `node >= 22`.

## Review Focus

- **Node.js binary missing from PATH:** NodeMcpBridge raises a clear, actionable error instructing the user to install Node.js 22+.
- **Node process crash or unexpected exit:** Bridge detects child process termination and returns clean error descriptions instead of hanging indefinitely.
- **Concurrent tool calls:** JSON-RPC message correlation IDs ensure thread-safe request/response mapping without cross-talk.
- **Empty or invalid query parameters:** Handlers sanitize inputs and pass sensible defaults to the MCP server.
- **Clean shutdown:** Verify no orphan Node processes linger after Python interpreter exits.

---

### Task 1: Create Hermes Plugin Manifest (`plugin.yaml`)

**Files:**

- Create: `plugin.yaml`
- Test: `test/test_hermes_manifest.py`

**Interfaces:**

- Consumes: Spec metadata values (`name: apple-doc-plugin`, `manifest_version: 2`, `provides_tools`).
- Produces: `plugin.yaml` discoverable by `hermes plugins` CLI and catalog validator.

- [ ] **Step 1: Write failing test for manifest structure**

```python
# test/test_hermes_manifest.py
import yaml
from pathlib import Path

def test_manifest_structure():
    manifest_path = Path(__file__).parent.parent / "plugin.yaml"
    assert manifest_path.exists(), "plugin.yaml must exist"
    data = yaml.safe_load(manifest_path.read_text())
    assert data["name"] == "apple-doc-plugin"
    assert data["manifest_version"] == 2
    assert "provides_tools" in data
    assert "search_symbols" in data["provides_tools"]
    assert "get_documentation" in data["provides_tools"]
    assert "semantic_search" in data["provides_tools"]
    assert "discover_technologies" in data["provides_tools"]
    assert "get_version" in data["provides_tools"]
    assert "index_info" in data["provides_tools"]
    assert any(dep.get("name") == "node" for dep in data.get("external_dependencies", []))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest test/test_hermes_manifest.py -v`
Expected: FAIL (file does not exist)

- [ ] **Step 3: Implement `plugin.yaml`**

Create `plugin.yaml` at repo root with Manifest v2 schema, description, tags, platforms, `external_dependencies`, and `provides_tools`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest test/test_hermes_manifest.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin.yaml test/test_hermes_manifest.py
git commit -m "feat(hermes): add plugin.yaml manifest v2 for Hermes catalog"
```

---

### Task 2: Implement Stdio MCP Bridge (`hermes_bridge.py`)

**Files:**

- Create: `hermes_bridge.py`
- Test: `test/test_hermes_bridge.py`

**Interfaces:**

- Consumes: `node bin/launcher.cjs` over stdin/stdout via JSON-RPC 2.0.
- Produces: `NodeMcpBridge` class with `call_tool(name: str, arguments: dict) -> str` and `close()`.

- [ ] **Step 1: Write failing test for `NodeMcpBridge`**

```python
# test/test_hermes_bridge.py
from hermes_bridge import NodeMcpBridge
import json

def test_bridge_get_version():
    bridge = NodeMcpBridge()
    try:
        raw_result = bridge.call_tool("get_version", {})
        assert "version" in raw_result or "1.0.0" in raw_result
    finally:
        bridge.close()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest test/test_hermes_bridge.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'hermes_bridge'`

- [ ] **Step 3: Implement `hermes_bridge.py`**

Implement `NodeMcpBridge` with:

- Subprocess spawning of `node bin/launcher.cjs`.
- Standard MCP JSON-RPC initialization handshake (`initialize` -> `notifications/initialized`).
- Background stdout reader thread correlating response IDs to `threading.Event` futures.
- Thread-safe `call_tool(name, arguments)` producing text response.
- `atexit.register(self.close)` and clean process termination.
- Friendly error if `node` is missing or fails to launch.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest test/test_hermes_bridge.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add hermes_bridge.py test/test_hermes_bridge.py
git commit -m "feat(hermes): implement NodeMcpBridge stdio JSON-RPC client"
```

---

### Task 3: Implement Hermes Plugin Entrypoint (`__init__.py`)

**Files:**

- Create: `__init__.py`
- Test: `test/test_hermes_registration.py`

**Interfaces:**

- Consumes: `NodeMcpBridge` from `hermes_bridge.py`.
- Produces: `register(ctx)` entrypoint registering all 6 tools with Hermes.

- [ ] **Step 1: Write failing test for `register(ctx)`**

```python
# test/test_hermes_registration.py
from unittest.mock import MagicMock
import __init__ as hermes_plugin

def test_register_exposes_tools():
    mock_ctx = MagicMock()
    registered_tools = {}

    def mock_register_tool(name, schema=None, handler=None, toolset=None):
        registered_tools[name] = {"schema": schema, "handler": handler}

    mock_ctx.register_tool.side_effect = mock_register_tool
    mock_ctx.tool = None

    hermes_plugin.register(mock_ctx)
    expected_tools = {
        "search_symbols",
        "semantic_search",
        "get_documentation",
        "discover_technologies",
        "get_version",
        "index_info",
    }
    assert expected_tools.issubset(registered_tools.keys())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest test/test_hermes_registration.py -v`
Expected: FAIL with `ModuleNotFoundError` or missing `register`

- [ ] **Step 3: Implement `__init__.py`**

Implement `register(ctx)`:

- Support both `ctx.register_tool(...)` and `@ctx.tool(...)` syntax.
- Provide JSON schemas matching the MCP tool signatures for each tool.
- Route tool calls through `get_bridge().call_tool(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest test/test_hermes_registration.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add __init__.py test/test_hermes_registration.py
git commit -m "feat(hermes): implement native register(ctx) entrypoint"
```

---

### Task 4: End-to-End Hermes Plugin Execution Test

**Files:**

- Create: `test/test_hermes_e2e.py`

**Interfaces:**

- Consumes: `register(ctx)` from `__init__.py` and live `bin/launcher.cjs`.
- Produces: Full verification of documentation lookup via Hermes plugin handlers.

- [ ] **Step 1: Write end-to-end integration test**

```python
# test/test_hermes_e2e.py
from unittest.mock import MagicMock
import __init__ as hermes_plugin

def test_hermes_e2e_search_and_lookup():
    mock_ctx = MagicMock()
    tools = {}
    mock_ctx.register_tool.side_effect = lambda name, **kw: tools.update({name: kw})

    hermes_plugin.register(mock_ctx)

    # 1. Test search_symbols
    search_handler = tools["search_symbols"]["handler"]
    search_res = search_handler({"query": "NavigationStack", "framework": "SwiftUI"})
    assert "NavigationStack" in search_res

    # 2. Test get_documentation
    doc_handler = tools["get_documentation"]["handler"]
    doc_res = doc_handler({"path": "NavigationStack", "framework": "SwiftUI"})
    assert "NavigationStack" in doc_res or "Structure" in doc_res
```

- [ ] **Step 2: Run test to verify it passes**

Run: `python3 -m pytest test/test_hermes_e2e.py -v`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add test/test_hermes_e2e.py
git commit -m "test(hermes): add end-to-end Hermes plugin integration test"
```

---

### Task 5: Documentation & Catalog Validation

**Files:**

- Modify: `README.md`
- Modify: `AGENT_TASKS.md`

**Interfaces:**

- Consumes: Completed Hermes plugin capabilities.
- Produces: Updated docs with `hermes plugins install` instructions and catalog verification steps.

- [ ] **Step 1: Update README.md with Hermes installation instructions**

Add a dedicated `Hermes Agent Plugin` section under `Install`:

```markdown
### Hermes Agent Plugin

Install directly into Hermes Agent via CLI:
\`\`\`bash
hermes plugins install https://github.com/AndrewMason7/apple-doc-plugin.git
hermes plugins enable apple-doc-plugin
\`\`\`
```

- [ ] **Step 2: Run all tests (npm test + pytest)**

Run:

```bash
npm test
python3 -m pytest test/ -v
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md AGENT_TASKS.md
git commit -m "docs(hermes): document Hermes Agent installation and plugin catalog usage"
```
