"""
Apple Developer Documentation Plugin for Hermes Agent.

Exposes native tools for offline Apple API documentation search, SQLite FTS5 matching,
and Apple DocC extraction.
"""

try:
    from .bridges.hermes import register, TOOL_DEFINITIONS
except (ImportError, ValueError):
    from bridges.hermes import register, TOOL_DEFINITIONS

__all__ = ["register", "TOOL_DEFINITIONS"]
