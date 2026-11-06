"""
Apple Developer Documentation Plugin for Hermes Agent.

Exposes native tools for offline Apple API documentation search, SQLite FTS5 matching,
and Apple DocC extraction.
"""

from typing import Any, Callable, Dict, Optional

try:
    from .hermes_bridge import get_bridge, NodeMcpBridge
except ImportError:
    from hermes_bridge import get_bridge, NodeMcpBridge

TOOL_DEFINITIONS = [
    {
        "name": "discover_technologies",
        "description": "List and filter Apple frameworks that are indexed in the local database.",
        "parameters": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "number",
                    "description": "Optional page number (default 1)",
                },
                "pageSize": {
                    "type": "number",
                    "description": "Optional page size (default 25, max 100)",
                },
                "query": {
                    "type": "string",
                    "description": "Optional keyword to filter technologies",
                },
            },
        },
    },
    {
        "name": "get_documentation",
        "description": (
            "Point lookup for detailed symbol or article documentation (Swift syntax declarations, "
            "parameters, return types, deprecations). Queries local SQLite database first, falling back to "
            "Apple DocC CDN. Not a search tool. Pass framework directly (e.g. framework: 'SwiftUI') if known."
        ),
        "parameters": {
            "type": "object",
            "required": ["path"],
            "properties": {
                "framework": {
                    "type": "string",
                    "description": "Optional framework name (e.g. 'SwiftUI', 'UIKit'). If omitted, framework is auto-detected.",
                },
                "concise": {
                    "type": "boolean",
                    "description": "Optional compact token-budgeted mode. Strips lengthy discussions and returns only declarations, parameters, and return types.",
                },
                "path": {
                    "type": "string",
                    "description": "Symbol path or relative name (e.g. 'View', 'GridItem', 'documentation/SwiftUI/NavigationStack')",
                },
            },
        },
    },
    {
        "name": "semantic_search",
        "description": (
            "Hybrid search combining SQLite FTS5 lexical search and vector embeddings with Reciprocal Rank Fusion (RRF). "
            "Search by natural language intent, conceptual query, or API name. "
            "If vector embedding provider is unavailable, automatically falls back to lexical search."
        ),
        "parameters": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "framework": {
                    "type": "string",
                    "description": "Optional framework name to scope semantic search (e.g. 'SwiftUI', 'UIKit')",
                },
                "maxResults": {
                    "type": "number",
                    "description": "Optional maximum number of results (default 20, max 100)",
                },
                "platform": {
                    "type": "string",
                    "description": "Optional platform filter (iOS, macOS, watchOS, visionOS)",
                },
                "query": {
                    "type": "string",
                    "description": "Natural language description of the desired behavior, UI pattern, concept, or symbol name",
                },
                "symbolType": {
                    "type": "string",
                    "description": "Optional symbol kind filter (struct, class, protocol, func, etc.)",
                },
            },
        },
    },
    {
        "name": "search_symbols",
        "description": (
            "Lexical symbol search using SQLite FTS5 BM25 with exact-title boosting and wildcard pattern matching (*, ?). "
            "Accepts optional framework, platform, and symbolType. Purely local lexical search; does not call cloud APIs."
        ),
        "parameters": {
            "type": "object",
            "required": ["query"],
            "properties": {
                "framework": {
                    "type": "string",
                    "description": "Optional framework name to scope search (e.g. 'SwiftUI', 'UIKit', 'SwiftData')",
                },
                "maxResults": {
                    "type": "number",
                    "description": "Optional maximum number of results (default 20, max 100)",
                },
                "platform": {
                    "type": "string",
                    "description": "Optional platform filter (iOS, macOS, watchOS, visionOS)",
                },
                "query": {
                    "type": "string",
                    "description": "Search query: exact symbol name ('NavigationSplitView'), wildcard pattern ('Grid*'), or keyword",
                },
                "symbolType": {
                    "type": "string",
                    "description": "Optional symbol kind filter (struct, class, protocol, func, etc.)",
                },
            },
        },
    },
    {
        "name": "get_version",
        "description": "Get the current server version and runtime index metadata (symbol count, indexed frameworks, embedding status).",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "index_info",
        "description": "Get runtime SQLite index metadata including symbol count, indexed frameworks, and embedding status.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
]


def _make_handler(tool_name: str) -> Callable[..., str]:
    def handler(*args: Any, **kwargs: Any) -> str:
        try:
            call_args: Dict[str, Any] = {}
            if args:
                if isinstance(args[0], dict):
                    call_args.update(args[0])
                elif isinstance(args[0], str):
                    primary_key = "path" if tool_name == "get_documentation" else "query"
                    call_args[primary_key] = args[0]
            call_args.update(kwargs)
            return get_bridge().call_tool(tool_name, call_args)
        except Exception as err:
            return f"Error executing {tool_name}: {err}"

    handler.__name__ = tool_name
    return handler


def register(ctx: Any) -> None:
    """
    Registers Apple Developer Documentation tools with Hermes Agent context.
    Supports both ctx.register_tool(...) and @ctx.tool(...) paradigms.
    """
    for tool_def in TOOL_DEFINITIONS:
        name = tool_def["name"]
        description = tool_def["description"]
        params = tool_def["parameters"]
        handler = _make_handler(name)

        if hasattr(ctx, "tool") and callable(ctx.tool):
            # Hermes decorator-style registration
            decorator = ctx.tool(name=name, description=description, parameters=params)
            decorator(handler)
        elif hasattr(ctx, "register_tool") and callable(ctx.register_tool):
            # Hermes method-style registration
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
                # Handle alternative parameter signature (name, schema, handler)
                ctx.register_tool(
                    name=name,
                    schema={
                        "name": name,
                        "description": description,
                        "parameters": params,
                    },
                    handler=handler,
                )
