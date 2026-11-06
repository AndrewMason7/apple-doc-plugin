import unittest
from pathlib import Path
try:
    import yaml
except ImportError:
    yaml = None

class TestHermesManifest(unittest.TestCase):
    def test_manifest_structure(self):
        manifest_path = Path(__file__).resolve().parent.parent.parent / "plugin.yaml"
        self.assertTrue(manifest_path.exists(), "plugin.yaml must exist")
        content = manifest_path.read_text()
        
        if yaml:
            data = yaml.safe_load(content)
        else:
            # Fallback simple parser for environments without pyyaml
            data = {}
            for line in content.splitlines():
                line = line.strip()
                if line.startswith("name:"):
                    data["name"] = line.split(":", 1)[1].strip()
                elif line.startswith("manifest_version:"):
                    data["manifest_version"] = int(line.split(":", 1)[1].strip())
            data["provides_tools"] = [
                tool.strip().replace("- ", "")
                for tool in content.split("provides_tools:")[1].split("\n")
                if tool.strip().startswith("- ")
            ]
            
        self.assertEqual(data.get("name"), "apple-doc-plugin")
        self.assertEqual(data.get("manifest_version"), 2)
        provides_tools = data.get("provides_tools", [])
        expected_tools = [
            "search_symbols",
            "semantic_search",
            "get_documentation",
            "discover_technologies",
            "get_version",
            "index_info"
        ]
        for tool in expected_tools:
            self.assertIn(tool, provides_tools)
        self.assertIn("node", content)

if __name__ == "__main__":
    unittest.main()
