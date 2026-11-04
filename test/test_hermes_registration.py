import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

root_dir = str(Path(__file__).resolve().parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

import __init__ as hermes_plugin

class TestHermesRegistration(unittest.TestCase):
    def test_register_exposes_tools(self):
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
        self.assertTrue(expected_tools.issubset(registered_tools.keys()))
        for tool_name in expected_tools:
            self.assertIsNotNone(registered_tools[tool_name]["handler"])

    def test_register_decorator_style(self):
        mock_ctx = MagicMock()
        decorated_tools = {}

        def mock_tool_decorator(name, description=None, parameters=None):
            def decorator(fn):
                decorated_tools[name] = {"description": description, "parameters": parameters, "fn": fn}
                return fn
            return decorator

        mock_ctx.tool = mock_tool_decorator
        hermes_plugin.register(mock_ctx)
        self.assertIn("search_symbols", decorated_tools)
        self.assertIn("get_documentation", decorated_tools)
        self.assertEqual(len(decorated_tools), 6)

if __name__ == "__main__":
    unittest.main()
