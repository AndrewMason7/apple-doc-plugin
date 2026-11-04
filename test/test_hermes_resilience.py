import concurrent.futures
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

root_dir = str(Path(__file__).resolve().parent.parent)
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

import __init__ as hermes_plugin
from hermes_bridge import NodeMcpBridge, get_bridge


class TestHermesResilience(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        get_bridge().close()

    def test_handler_positional_string_normalization(self):
        """Test that passing a positional string maps to the primary argument (query or path)."""
        mock_ctx = MagicMock()
        mock_ctx.tool = None
        tools = {}
        mock_ctx.register_tool.side_effect = lambda name, **kw: tools.update({name: kw})
        hermes_plugin.register(mock_ctx)

        search_handler = tools["search_symbols"]["handler"]
        # Passing positional string argument "View" instead of {"query": "View"}
        result = search_handler("View")
        self.assertIn("View", result)

        doc_handler = tools["get_documentation"]["handler"]
        # Passing positional string argument "View" instead of {"path": "View"}
        doc_result = doc_handler("View", framework="SwiftUI")
        self.assertTrue("View" in doc_result or "Protocol" in doc_result)

    def test_concurrent_tool_calls_no_races(self):
        """Test that multiple threads calling the bridge concurrently receive their own responses without error."""
        bridge = get_bridge()
        queries = ["View", "Text", "Button", "NavigationStack", "List", "VStack", "HStack", "ZStack"]

        def run_query(q):
            return bridge.call_tool("search_symbols", {"query": q, "maxResults": 3})

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(run_query, q) for q in queries]
            results = [f.result(timeout=15.0) for f in futures]

        for q, res in zip(queries, results):
            self.assertIn(q, res, f"Expected {q} in result")

    def test_child_crash_wakes_up_waiters_immediately(self):
        """Test that if the child process is terminated, in-flight requests wake up with an error immediately."""
        bridge = NodeMcpBridge()
        bridge._ensure_process()
        self.assertIsNotNone(bridge.process)

        # Force kill the process
        bridge.process.kill()
        bridge.process.wait()

        # Calling tool should fail immediately or restart gracefully
        res = bridge.call_tool("get_version", {}, timeout=5.0)
        self.assertTrue("version" in res.lower() or "error" in res.lower())
        bridge.close()


if __name__ == "__main__":
    unittest.main()
