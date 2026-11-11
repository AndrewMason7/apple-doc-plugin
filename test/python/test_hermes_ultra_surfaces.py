import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

ROOT_DIR = Path(__file__).resolve().parents[2]
BRIDGE_DIR = ROOT_DIR / "bridges" / "hermes"
for p in (str(ROOT_DIR), str(BRIDGE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

import bridges.hermes as hermes_plugin
from bridges.hermes.native_engine import get_native_engine


class TestHermesUltraSurfaces(unittest.TestCase):
    def setUp(self):
        self.engine = get_native_engine()

    def test_native_engine_index_stats(self):
        stats = self.engine.get_index_stats()
        self.assertTrue(stats["ok"])
        self.assertGreaterEqual(stats["symbolCount"], 95000)
        self.assertGreaterEqual(stats["frameworkCount"], 20)

    def test_wildcard_and_idiom_rrf_search(self):
        wc = self.engine.search_symbols_data("Navigation*View", framework="SwiftUI", max_results=10)
        titles = [r["title"] for r in wc["results"]]
        self.assertIn("NavigationSplitView", titles)

        idiom = self.engine.semantic_search_data("React useEffect equivalent", framework="SwiftUI", max_results=6)
        self.assertTrue(idiom["expansion"]["hasExpansion"])
        joined = "\n".join(r["title"] for r in idiom["results"])
        self.assertTrue("task" in joined or "onAppear" in joined)

        beh = self.engine.semantic_search_data("prevent sheet swipe dismiss", framework="SwiftUI", max_results=5)
        beh_titles = "\n".join(r["title"] for r in beh["results"])
        self.assertIn("interactiveDismissDisabled", beh_titles)

    def test_compiler_diagnostic_hook_behavior(self):
        hooks = {}
        mock_ctx = MagicMock()
        mock_ctx.tool = None
        mock_ctx.get_config.side_effect = lambda k, default=None: default
        mock_ctx.register_hook.side_effect = lambda name, cb, **kw: hooks.update({name: cb})

        hermes_plugin.register(mock_ctx)
        self.assertIn("transform_terminal_output", hooks)
        hook_fn = hooks["transform_terminal_output"]

        # 1. Non-zero swift build with deprecated symbols gets grounded
        err_out = (
            "ContentView.swift:10:5: warning: 'NavigationView' was deprecated in iOS 16.0\n"
            "ContentView.swift:14:8: error: value of type 'View' has no member 'navigationBarItems'\n"
        )
        transformed = hook_fn(command="swift build", output=err_out, returncode=1)
        self.assertIsNotNone(transformed)
        self.assertIn("[Apple DocC Grounding", transformed)
        self.assertIn("NavigationStack", transformed)
        self.assertIn("ToolbarItem", transformed)

        # 2. Successful build (returncode=0) is untouched
        self.assertIsNone(hook_fn(command="swift build", output="Build complete!", returncode=0))

        # 3. Unrelated command is untouched
        self.assertIsNone(hook_fn(command="pytest -q", output=err_out, returncode=1))

        # 4. Config opt-out disables grounding
        mock_ctx.get_config.side_effect = lambda k, default=None: False if k == "compiler_grounding" else default
        self.assertIsNone(hook_fn(command="swift build", output=err_out, returncode=1))

    def test_slash_command_modes_and_inline_directives(self):
        commands = {}
        mock_ctx = MagicMock()
        mock_ctx.tool = None
        mock_ctx.register_command.side_effect = lambda name, handler, **kw: commands.update({name: handler})

        hermes_plugin.register(mock_ctx)
        self.assertIn("apple-docs", commands)
        slash = commands["apple-docs"]

        demo_md = slash("demo")
        self.assertIn("Apple Docs Ultra", demo_md)
        self.assertIn("::apple-doc{", demo_md)

        status_md = slash("status")
        self.assertIn("95,899", status_md)

        idiom_md = slash("idiom SharedPreferences")
        self.assertIn("AppStorage", idiom_md)

        doc_md = slash("doc NavigationSplitView")
        self.assertIn("NavigationSplitView", doc_md)

    def test_dashboard_plugin_api_routes(self):
        api_path = ROOT_DIR / "dashboard" / "plugin_api.py"
        spec = importlib.util.spec_from_file_location("test_apple_docs_api", str(api_path))
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)

        st = mod.get_status()
        self.assertGreaterEqual(st["symbolCount"], 95000)

        sr = mod.search_docs(q="useEffect", mode="semantic", framework="SwiftUI", platform=None, symbol_type=None, limit=5)
        self.assertGreater(len(sr["results"]), 0)

        idioms = mod.get_idioms(ecosystem="react", q=None)
        self.assertGreater(idioms["count"], 0)

        diag = mod.diagnose_build_output({
            "command": "swift build",
            "output": "warning: 'foregroundColor' was deprecated in iOS 17.0",
            "returncode": 1,
        })
        self.assertTrue(diag["matched"])
        self.assertEqual(diag["findings"][0]["symbol"], "foregroundColor")

        # /doc endpoint verification
        doc = mod.get_doc(path="NavigationSplitView", framework="SwiftUI", live=False)
        self.assertTrue(doc["ok"])
        self.assertEqual(doc["title"], "NavigationSplitView")

        # /doc error handling on missing/empty path
        with self.assertRaises(mod.HTTPException) as ctx_err:
            mod.get_doc(path="")
        self.assertEqual(ctx_err.exception.status_code, 400)

        # /demo endpoint verification
        demo = mod.run_demo()
        self.assertIn("stats", demo)
        self.assertIn("markdown", demo)

        # Direct parameter parsing with defaults and fallbacks
        default_sr = mod.search_docs()
        self.assertIn("results", default_sr)

        lexical_sr = mod.search_docs(q="Navigation*View", mode="lexical", limit=10)
        self.assertGreater(len(lexical_sr["results"]), 0)

        default_diag = mod.diagnose_build_output()
        self.assertIn("matched", default_diag)

        all_idioms = mod.get_idioms()
        self.assertGreater(all_idioms["count"], 10)

    def test_desktop_plugin_manifest_and_sdk_imports(self):
        desktop_js = (ROOT_DIR / "desktop" / "plugin.js").read_text(encoding="utf-8")
        self.assertIn("id: PLUGIN_ID", desktop_js)
        self.assertIn("const PLUGIN_ID = 'apple-doc-plugin'", desktop_js)
        self.assertIn("from '@hermes/plugin-sdk'", desktop_js)
        self.assertNotIn("window.hermesDesktop", desktop_js)

    def test_dashboard_manifest_entry_resolves_and_registers(self):
        """The web dashboard resolves `entry` inside dashboard/ and injects it as a
        <script> for every discovered manifest (defaults: entry=dist/index.js, and a
        live default tab). A missing entry file means a 404 script fetch and a dead
        tab, so the bundle must exist and must call register()."""
        import json

        manifest = json.loads(
            (ROOT_DIR / "dashboard" / "manifest.json").read_text(encoding="utf-8")
        )
        entry = manifest.get("entry", "dist/index.js")
        entry_path = ROOT_DIR / "dashboard" / entry
        self.assertTrue(
            entry_path.is_file(),
            f"dashboard manifest entry must resolve to a real file: dashboard/{entry}",
        )
        bundle = entry_path.read_text(encoding="utf-8")
        self.assertIn("window.__HERMES_PLUGIN_SDK__", bundle)
        self.assertIn("window.__HERMES_PLUGINS__.register('apple-doc-plugin'", bundle)
        # Same-origin only: the SDK fetchers reject absolute cross-origin URLs by
        # design, and the bundle must not bypass them with a raw fetch.
        self.assertNotIn("fetch(", bundle)
        tab = manifest.get("tab") or {}
        self.assertEqual(tab.get("path"), "/apple-docs")

        # Contract: the bundle's endpoints must match the plugin's own FastAPI
        # router and the engine's real response fields — pinning the exact 404 /
        # missing-field class of bug this tab shipped to fix.
        self.assertIn("'/api/plugins/apple-doc-plugin'", bundle)
        for endpoint in ("/status", "/search?q="):
            self.assertIn(endpoint, bundle)
        rows = self.engine.search_symbols_data("NavigationSplitView", max_results=3)["results"]
        self.assertTrue(rows, "engine search must return rows for the contract check")
        for field in ("id", "title", "framework", "kind", "abstract", "webUrl"):
            self.assertIn(field, rows[0])
        stats = self.engine.get_index_stats()
        for field in ("symbolCount", "frameworkCount"):
            self.assertIn(field, stats)

    def test_bridge_child_env_isolates_credentials(self):
        """The bridge child env must pin APPLE_DOCS_DISABLE_ADC=1 and must not
        pass through ambient Google credential variables."""
        from bridges.hermes import hermes_bridge

        env = hermes_bridge._build_isolated_child_env()
        self.assertEqual(env.get("APPLE_DOCS_DISABLE_ADC"), "1")
        self.assertNotIn("GOOGLE_APPLICATION_CREDENTIALS", env)
        self.assertNotIn("GOOGLE_API_KEY", env)
        self.assertNotIn("GOOGLE_CLOUD_PROJECT", env)
        self.assertIn("PATH", env)


if __name__ == "__main__":
    unittest.main()
