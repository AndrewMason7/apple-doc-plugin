import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

root_dir = str(Path(__file__).resolve().parent.parent.parent)
bridge_dir = str(Path(__file__).resolve().parent.parent.parent / "bridges" / "hermes")
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)
if bridge_dir not in sys.path:
    sys.path.insert(0, bridge_dir)

try:
    import bridges.hermes as hermes_plugin
    from bridges.hermes.hermes_bridge import get_bridge
except ImportError:
    import __init__ as hermes_plugin
    from hermes_bridge import get_bridge

class TestHermesE2E(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        get_bridge().close()

    def test_hermes_e2e_full_suite(self):
        mock_ctx = MagicMock()
        tools = {}

        def mock_register_tool(name, schema=None, handler=None, toolset=None):
            tools[name] = {"schema": schema, "handler": handler}

        mock_ctx.register_tool.side_effect = mock_register_tool
        mock_ctx.tool = None

        hermes_plugin.register(mock_ctx)

        # 1. Test get_version
        version_handler = tools["get_version"]["handler"]
        ver_res = version_handler({})
        self.assertTrue("version" in ver_res.lower() or "1.0.0" in ver_res, f"Unexpected version result: {ver_res}")

        # 2. Test search_symbols
        search_handler = tools["search_symbols"]["handler"]
        search_res = search_handler({"query": "NavigationStack", "framework": "SwiftUI"})
        self.assertIn("NavigationStack", search_res)

        # 3. Test get_documentation
        doc_handler = tools["get_documentation"]["handler"]
        doc_res = doc_handler({"path": "NavigationStack", "framework": "SwiftUI"})
        self.assertTrue("NavigationStack" in doc_res or "Structure" in doc_res or "SwiftUI" in doc_res)

        # 4. Test discover_technologies
        discover_handler = tools["discover_technologies"]["handler"]
        discover_res = discover_handler({"pageSize": 5})
        self.assertTrue("SwiftUI" in discover_res or "Foundation" in discover_res)

if __name__ == "__main__":
    unittest.main()
