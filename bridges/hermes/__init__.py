"""
Apple Developer Documentation Plugin for Hermes Agent (v1.1.0 — Hermes Native Suite).

Surfaces integrated:
1. 6 Native Tools (`apple_docs` toolset): sub-5ms Python SQLite FTS5 + Cross-Framework Idiom RRF
   over 95,899 Apple SDK symbols across 30 frameworks, with optional 768-d Node vector upgrade.
2. `transform_terminal_output` Hook: automatic Swift/Xcode compiler diagnostic grounding on failed
   `swift build` / `swift test` / `swiftc` / `xcodebuild` commands.
3. `@apple:` Context Reference Provider: inline `@apple:NavigationSplitView` & `@apple:useEffect`
   expansion with live FTS5 autocomplete.
4. `/apple-docs` In-Session Slash Command (`/apple-docs demo`, `search`, `idiom`, `doc`, `diagnose`, `status`).
5. `hermes apple-docs` CLI Subcommand (`hermes apple-docs demo`, `status`, `search`, `idiom`, `doc`).
6. Bundled `apple-docs` Skill + Desktop `::apple-doc{...}` Inline Transcript Card guidance.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import re
import sys
from typing import Any, Callable, Dict, List, Optional

try:
    from .hermes_bridge import NodeMcpBridge, get_bridge
    from .native_engine import CROSS_FRAMEWORK_IDIOMS, AppleDocsNativeEngine, get_native_engine
except ImportError:
    from hermes_bridge import NodeMcpBridge, get_bridge
    from native_engine import CROSS_FRAMEWORK_IDIOMS, AppleDocsNativeEngine, get_native_engine

_DISPATCH_META_KEYS = frozenset({
    "parent_agent",
    "task_id",
    "session_id",
    "session_key",
    "tool_call_id",
    "user_task",
})

_SWIFT_BUILD_CMD_RE = re.compile(
    r"(?:^|[;&|\s/])(?:swift|swiftc|xcodebuild)\b"
)

TOOL_DEFINITIONS: List[Dict[str, Any]] = [
    {
        "name": "discover_technologies",
        "description": (
            "List and filter Apple SDK frameworks indexed in the local 95,899-symbol SQLite database "
            "(SwiftUI, SwiftData, UIKit, AppKit, Foundation, Observation, RealityKit, Vision, StoreKit, Security, etc.)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "page": {"type": "number", "description": "Optional page number (default 1)"},
                "pageSize": {"type": "number", "description": "Optional page size (default 25, max 100)"},
                "query": {"type": "string", "description": "Optional keyword to filter technologies"},
            },
        },
    },
    {
        "name": "get_documentation",
        "description": (
            "Point lookup for detailed Apple symbol or article documentation (Swift 6 syntax declarations, "
            "parameters, return types, OS availability, deprecations). Resolves against the local 95,899-symbol "
            "SQLite database first and enriches from Apple's DocC JSON feed when reachable. Pass bare symbol names "
            "('NavigationSplitView', 'interactiveDismissDisabled') or DocC paths ('/documentation/swiftui/view')."
        ),
        "parameters": {
            "type": "object",
            "required": ["path"],
            "properties": {
                "framework": {
                    "type": "string",
                    "description": "Optional framework name (e.g. 'SwiftUI', 'UIKit', 'SwiftData').",
                },
                "concise": {
                    "type": "boolean",
                    "description": "Compact token-budgeted mode returning declarations, availability, and parameters.",
                },
                "path": {
                    "type": "string",
                    "description": "Symbol name or DocC path (e.g. 'NavigationSplitView', 'SecItemAdd', '/documentation/swiftui/griditem').",
                },
            },
        },
    },
    {
        "name": "semantic_search",
        "description": (
            "Primary Apple API search combining Cross-Framework Idiom Expansion (React useEffect, CSS Flexbox, "
            "Android SharedPreferences/Room -> SwiftUI/SwiftData), behavioral intent matching, SQLite FTS5 BM25, "
            "and 768-d vector Reciprocal Rank Fusion (RRF) when dense vectors are hydrated."
        ),
        "parameters": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "framework": {
                    "type": "string",
                    "description": "Optional framework filter (e.g. 'SwiftUI', 'Foundation', 'Security').",
                },
                "maxResults": {
                    "type": "number",
                    "description": "Maximum results to return (default 20, max 100).",
                },
                "platform": {
                    "type": "string",
                    "description": "Optional platform filter (iOS, macOS, watchOS, tvOS, visionOS).",
                },
                "query": {
                    "type": "string",
                    "description": "Natural language behavior ('prevent sheet swipe dismiss'), cross-framework idiom ('useEffect'), or API name.",
                },
                "symbolType": {
                    "type": "string",
                    "description": "Optional symbol kind filter (struct, class, protocol, func, var, macro, enum).",
                },
            },
        },
    },
    {
        "name": "search_symbols",
        "description": (
            "Sub-5ms offline lexical symbol search over 95,899 Apple SDK symbols using SQLite FTS5 BM25 "
            "with exact-title boosting and wildcard pattern matching ('Grid*', '*Style', 'Navigation*View'). "
            "Purely local; never makes network calls."
        ),
        "parameters": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "framework": {
                    "type": "string",
                    "description": "Optional framework filter (e.g. 'SwiftUI', 'UIKit', 'SwiftData').",
                },
                "maxResults": {
                    "type": "number",
                    "description": "Maximum results to return (default 20, max 100).",
                },
                "platform": {
                    "type": "string",
                    "description": "Optional platform filter (iOS, macOS, watchOS, tvOS, visionOS).",
                },
                "query": {
                    "type": "string",
                    "description": "Exact symbol name ('NavigationSplitView'), wildcard ('Grid*'), or keyword.",
                },
                "symbolType": {
                    "type": "string",
                    "description": "Optional symbol kind filter (struct, class, protocol, func, var, enum).",
                },
            },
        },
    },
    {
        "name": "get_version",
        "description": "Get Apple Documentation engine version, indexed symbol count, framework list, and search mode.",
        "parameters": {"type": "object", "properties": {}},
    },
    {
        "name": "index_info",
        "description": "Get runtime SQLite index metadata including 95,899 symbol breakdown, frameworks, and vector hydration status.",
        "parameters": {"type": "object", "properties": {}},
    },
]

_SYSTEM_PROMPT_GUIDANCE = (
    "Apple Developer Documentation (`apple-doc-plugin`): 95,899 offline symbols across 30 Apple frameworks. "
    "Users can attach docs inline with `@apple:<symbol-or-idiom>` or run `/apple-docs demo`. "
    "On Hermes Desktop, after verifying an Apple API via `get_documentation` or `semantic_search`, "
    "you may render an interactive API card inline in your reply by placing "
    '`::apple-doc{title="SymbolName" framework="SwiftUI" kind="struct" path="/documentation/swiftui/symbolname" summary="Short summary"}` '
    "on its own line."
)


def _execute_tool(tool_name: str, call_args: Dict[str, Any], prefer_node: bool = False) -> str:
    engine: AppleDocsNativeEngine = get_native_engine()

    if prefer_node or (tool_name == "semantic_search" and engine.has_hydrated_vectors()):
        try:
            return get_bridge().call_tool(tool_name, call_args)
        except Exception:
            pass

    if tool_name in ("get_version", "index_info"):
        return engine.format_version_markdown()

    if tool_name == "discover_technologies":
        return engine.format_discover_markdown(
            query=str(call_args.get("query") or ""),
            page=int(call_args.get("page") or 1),
            page_size=int(call_args.get("pageSize") or 25),
        )

    if tool_name == "search_symbols":
        data = engine.search_symbols_data(
            query=str(call_args.get("query") or ""),
            framework=call_args.get("framework"),
            platform=call_args.get("platform"),
            symbol_type=call_args.get("symbolType"),
            max_results=int(call_args.get("maxResults") or 20),
        )
        return engine.format_search_markdown(data, semantic=False)

    if tool_name == "semantic_search":
        data = engine.semantic_search_data(
            query=str(call_args.get("query") or ""),
            framework=call_args.get("framework"),
            platform=call_args.get("platform"),
            symbol_type=call_args.get("symbolType"),
            max_results=int(call_args.get("maxResults") or 20),
        )
        return engine.format_search_markdown(data, semantic=True)

    if tool_name == "get_documentation":
        return engine.format_documentation_markdown(
            path=str(call_args.get("path") or ""),
            framework=call_args.get("framework"),
            concise=bool(call_args.get("concise", False)),
            allow_network=True,
        )

    return json.dumps({"error": f"Unknown tool: {tool_name}"})


def _make_handler(tool_name: str, get_prefer_node: Optional[Callable[[], bool]] = None) -> Callable[..., str]:
    def handler(*args: Any, **kwargs: Any) -> str:
        try:
            call_args: Dict[str, Any] = {}
            if args:
                if isinstance(args[0], dict):
                    call_args.update(args[0])
                elif isinstance(args[0], str):
                    primary_key = "path" if tool_name == "get_documentation" else "query"
                    call_args[primary_key] = args[0]
            for k, v in kwargs.items():
                if k not in _DISPATCH_META_KEYS:
                    call_args[k] = v
            prefer_node = bool(get_prefer_node()) if get_prefer_node else False
            return _execute_tool(tool_name, call_args, prefer_node=prefer_node)
        except Exception as err:
            return json.dumps({"ok": False, "tool": tool_name, "error": str(err)})

    handler.__name__ = tool_name
    return handler


def _make_compiler_hook(ctx: Any) -> Callable[..., Optional[str]]:
    def on_transform_terminal_output(
        command: str = "",
        output: str = "",
        returncode: int = 0,
        **kwargs: Any,
    ) -> Optional[str]:
        try:
            if hasattr(ctx, "get_config") and callable(ctx.get_config):
                if ctx.get_config("compiler_grounding", True) is False:
                    return None
            if returncode == 0 or not command or not output:
                return None
            if not _SWIFT_BUILD_CMD_RE.search(command):
                return None
            if "[Apple DocC Grounding" in output:
                return None

            diag = get_native_engine().diagnose_compiler_output(
                command=command, output=output[-16384:], returncode=returncode
            )
            if diag.get("matched") and diag.get("annotation"):
                return f"{output.rstrip()}\n{diag['annotation']}\n"
        except Exception:
            return None
        return None

    return on_transform_terminal_output


def _handle_slash_command(raw_args: str = "", **kwargs: Any) -> str:
    engine = get_native_engine()
    text = (raw_args or "").strip()
    if not text or text.lower() == "demo":
        return engine.run_showcase_demo()["markdown"]

    parts = text.split(None, 1)
    sub = parts[0].lower()
    rest = parts[1].strip() if len(parts) > 1 else ""

    if sub in ("status", "info", "version"):
        return engine.format_version_markdown()

    if sub in ("frameworks", "tech", "discover"):
        return engine.format_discover_markdown(query=rest)

    if sub in ("idiom", "translate", "bridge"):
        if not rest:
            rows = [
                "| Source Ecosystem | Idiom | Native Apple Equivalent |",
                "| :--- | :--- | :--- |",
            ]
            for m in CROSS_FRAMEWORK_IDIOMS[:12]:
                rows.append(
                    f"| `{m['ecosystem']}` | **{m['idiom']}** | {', '.join(f'`{s}`' for s in m['appleSymbols'][:3])} |"
                )
            rows.append("\nTry `/apple-docs idiom useEffect` or `/apple-docs idiom SharedPreferences`.")
            return "\n".join(rows)
        data = engine.semantic_search_data(query=rest, max_results=6)
        return engine.format_search_markdown(data, semantic=True)

    if sub in ("doc", "symbol"):
        if not rest:
            return "Usage: `/apple-docs doc <SymbolName or /documentation/framework/symbol>`"
        return engine.format_documentation_markdown(path=rest, concise=True)

    if sub == "diagnose":
        sample = rest or (
            "warning: 'NavigationView' was deprecated in iOS 16.0\n"
            "error: value of type 'some View' has no member 'navigationBarItems'"
        )
        diag = engine.diagnose_compiler_output("swift build", sample, returncode=1)
        return diag["annotation"] or "No deprecated or unknown Apple symbols detected in input."

    if sub == "search":
        q = rest or "NavigationSplitView"
        return engine.format_search_markdown(engine.search_symbols_data(query=q, max_results=8), semantic=False)

    return engine.format_search_markdown(engine.semantic_search_data(query=text, max_results=8), semantic=True)


def _setup_cli_parser(parser: Any) -> None:
    sub = parser.add_subparsers(dest="apple_docs_cmd")
    sub.add_parser("demo", help="Run zero-API-key benchmark across search, idioms, and compiler diagnostics")
    sub.add_parser("status", help="Show offline SQLite symbol count, frameworks, and engine health")
    p_search = sub.add_parser("search", help="Search 95,899 offline Apple SDK symbols (supports * wildcards)")
    p_search.add_argument("query", nargs="+", help="Search query or wildcard pattern")
    p_search.add_argument("-f", "--framework", default=None, help="Filter by Apple framework")
    p_idiom = sub.add_parser("idiom", help="Translate React/Web/Android idioms into native Apple APIs")
    p_idiom.add_argument("query", nargs="*", help="Idiom or behavioral description")
    p_doc = sub.add_parser("doc", help="Fetch point-lookup documentation for an Apple symbol")
    p_doc.add_argument("path", help="Symbol title or DocC path")
    p_doc.add_argument("-f", "--framework", default=None, help="Optional framework disambiguator")


def _handle_cli_command(args: Any) -> int:
    cmd = getattr(args, "apple_docs_cmd", None) or "demo"
    if cmd == "status":
        print(_handle_slash_command("status"))
    elif cmd == "search":
        q = " ".join(getattr(args, "query", []) or [])
        fw = getattr(args, "framework", None)
        eng = get_native_engine()
        print(eng.format_search_markdown(eng.search_symbols_data(q, framework=fw, max_results=10)))
    elif cmd == "idiom":
        q = " ".join(getattr(args, "query", []) or [])
        print(_handle_slash_command(f"idiom {q}".strip()))
    elif cmd == "doc":
        eng = get_native_engine()
        print(eng.format_documentation_markdown(getattr(args, "path", ""), framework=getattr(args, "framework", None), concise=True))
    else:
        print(_handle_slash_command("demo"))
    return 0


def _register_context_reference_if_available(ctx: Any) -> None:
    if not (hasattr(ctx, "register_context_reference") and callable(ctx.register_context_reference)):
        return
    try:
        from agent.context_references import ContextCompletionItem, ContextReferenceProvider
    except ImportError:
        return

    class AppleDocsContextReferenceProvider(ContextReferenceProvider):
        prefix = "apple"
        description = "Offline Apple Developer Documentation symbol or React/Android idiom (@apple:NavigationSplitView)"

        async def autocomplete(self, query: str, *, limit: int = 10) -> List[Any]:
            def _lookup() -> List[Any]:
                eng = get_native_engine()
                q = (query or "").strip()
                items: List[Any] = []
                if not q:
                    defaults = [
                        ("NavigationSplitView", "SwiftUI · struct — Multi-column split view"),
                        ("interactiveDismissDisabled", "SwiftUI · method — Prevent sheet swipe dismiss"),
                        ("Observable", "Observation · macro — Reactive model macro"),
                        ("ModelContainer", "SwiftData · class — Persistence container"),
                        ("useEffect", "React -> SwiftUI idiom (.task / .onAppear)"),
                    ]
                    for sym, meta in defaults[:limit]:
                        items.append(ContextCompletionItem(text=f"@apple:{sym}", display=sym, meta=meta))
                    return items

                q_low = q.lower()
                for m in CROSS_FRAMEWORK_IDIOMS:
                    if q_low in m["idiom"].lower() or any(q_low in a.lower() for a in m.get("aliases", [])):
                        tok = m["idiom"].split()[0]
                        items.append(
                            ContextCompletionItem(
                                text=f"@apple:{tok}",
                                display=f"{m['idiom']} ({m['ecosystem']} -> Apple)",
                                meta=", ".join(m["appleSymbols"][:2]),
                            )
                        )
                        if len(items) >= 3:
                            break

                res = eng.search_symbols_data(q, max_results=max(limit - len(items), 4))["results"]
                for r in res:
                    target = f"{r['framework']}/{r['title'].split('(', 1)[0].replace('func ', '').replace('var ', '').strip()}"
                    if " " in target:
                        target = r["path"].lstrip("/")
                    items.append(
                        ContextCompletionItem(
                            text=f"@apple:{target}",
                            display=r["title"][:60],
                            meta=f"{r['framework']} · {r['kind']}",
                        )
                    )
                    if len(items) >= limit:
                        break
                return items

            return await asyncio.to_thread(_lookup)

        async def expand(self, target: str) -> Optional[str]:
            clean = (target or "").strip().strip("'\"`")
            if not clean:
                return None

            def _resolve() -> str:
                eng = get_native_engine()
                if "/" in clean and not clean.lower().startswith("documentation/") and not clean.startswith("/"):
                    fw, sym = clean.split("/", 1)
                    doc = eng.get_documentation_data(sym, framework=fw, concise=True, allow_network=True)
                    if doc.get("ok"):
                        return eng.format_documentation_markdown(sym, framework=fw, concise=True, allow_network=True)
                doc = eng.get_documentation_data(clean, concise=True, allow_network=True)
                if doc.get("ok"):
                    return eng.format_documentation_markdown(clean, concise=True, allow_network=True)
                sem = eng.semantic_search_data(clean, max_results=5)
                return eng.format_search_markdown(sem, semantic=True)

            return await asyncio.to_thread(_resolve)

    try:
        ctx.register_context_reference(AppleDocsContextReferenceProvider())
    except Exception:
        pass


def register(ctx: Any) -> None:
    """Register Apple Developer Documentation tools, hooks, commands, skill, and @apple: references."""

    def _prefer_node() -> bool:
        if hasattr(ctx, "get_config") and callable(ctx.get_config):
            return bool(ctx.get_config("prefer_node_bridge", False))
        return False

    for tool_def in TOOL_DEFINITIONS:
        name = tool_def["name"]
        description = tool_def["description"]
        params = tool_def["parameters"]
        handler = _make_handler(name, get_prefer_node=_prefer_node)

        if getattr(ctx, "tool", None) is not None and callable(ctx.tool):
            decorator = ctx.tool(name=name, description=description, parameters=params)
            decorator(handler)
        elif hasattr(ctx, "register_tool") and callable(ctx.register_tool):
            try:
                ctx.register_tool(
                    name=name,
                    toolset="apple_docs",
                    schema={
                        "name": name,
                        "description": description,
                        "parameters": params,
                    },
                    handler=handler,
                )
            except TypeError:
                ctx.register_tool(
                    name=name,
                    schema={
                        "name": name,
                        "description": description,
                        "parameters": params,
                    },
                    handler=handler,
                )

    if hasattr(ctx, "register_hook") and callable(ctx.register_hook):
        try:
            ctx.register_hook("transform_terminal_output", _make_compiler_hook(ctx))
        except Exception:
            pass

    if hasattr(ctx, "register_command") and callable(ctx.register_command):
        try:
            ctx.register_command(
                "apple-docs",
                _handle_slash_command,
                description="Search 95.9k offline Apple SDK symbols, translate React/Android idioms, or run `/apple-docs demo`",
                args_hint="[demo | idiom <term> | doc <symbol> | <query>]",
            )
        except Exception:
            pass

    if hasattr(ctx, "register_cli_command") and callable(ctx.register_cli_command):
        try:
            ctx.register_cli_command(
                "apple-docs",
                "Offline Apple Developer Documentation search, idiom bridge, and diagnostics",
                _setup_cli_parser,
                _handle_cli_command,
            )
        except Exception:
            pass

    _register_context_reference_if_available(ctx)

    if hasattr(ctx, "register_system_prompt_section") and callable(ctx.register_system_prompt_section):
        try:
            ctx.register_system_prompt_section(
                "apple-docs-directives",
                _SYSTEM_PROMPT_GUIDANCE,
                position="after_memory",
                max_chars=600,
            )
        except Exception:
            pass

    skill_path = Path(__file__).resolve().parents[2] / "skills" / "apple-docs" / "SKILL.md"
    if skill_path.exists() and hasattr(ctx, "register_skill") and callable(ctx.register_skill):
        skill_desc = (
            "Search Apple Developer Documentation, verify SwiftUI/SwiftData/UIKit/AppKit APIs, "
            "and ground modern Swift 6+ platform implementations."
        )
        try:
            for line in skill_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("description:"):
                    parsed = line.split(":", 1)[1].strip().strip("'\"")
                    if parsed:
                        skill_desc = parsed
                    break
        except OSError:
            pass
        try:
            ctx.register_skill("apple-docs", skill_path, description=skill_desc)
        except Exception as exc:
            sys.stderr.write(f"[apple-doc-plugin] Warning: could not register apple-docs skill: {exc}\n")

    if hasattr(ctx, "on_unload") and callable(ctx.on_unload):
        try:
            ctx.on_unload(lambda: get_bridge().close())
        except Exception:
            pass
