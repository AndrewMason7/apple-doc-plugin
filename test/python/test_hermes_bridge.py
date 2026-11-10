import sys
import unittest
from pathlib import Path

# Add project root and bridges/hermes to sys.path
root_dir = str(Path(__file__).resolve().parent.parent.parent)
bridge_dir = str(Path(__file__).resolve().parent.parent.parent / "bridges" / "hermes")
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)
if bridge_dir not in sys.path:
    sys.path.insert(0, bridge_dir)

try:
    from bridges.hermes.hermes_bridge import NodeMcpBridge
except ImportError:
    from hermes_bridge import NodeMcpBridge

class TestNodeMcpBridge(unittest.TestCase):
    def test_bridge_get_version(self):
        bridge = NodeMcpBridge()
        try:
            raw_result = bridge.call_tool("get_version", {})
            self.assertTrue(
                "version" in raw_result.lower() or "1.0" in raw_result,
                f"Expected version in result: {raw_result}"
            )
        finally:
            bridge.close()

if __name__ == "__main__":
    unittest.main()
