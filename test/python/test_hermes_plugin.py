"""Regression tests for the three deferred audit fixes in `apple-doc-plugin`.

1. `desktop/plugin.js` — `FALLBACK_STATS` must mirror the shipped Rule 17-stripped
   `data/apple-docs.db` (zero dense vectors, exact per-framework counts) and
   `localSearchFallback` must never substitute unrelated symbols on a zero match.
2. `bridges/hermes/native_engine.py` — `diagnose_compiler_output` must not label
   fuzzy/prefix FTS5 hits "Verified"; only `SWIFT_COMPILER_MIGRATIONS` entries are
   verified migrations.
3. `bridges/hermes/__init__.py` — `get_version` and `index_info` must not render
   the same markdown; `index_info` owns the detailed SQLite breakdown.
"""

import json
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
BRIDGE_DIR = ROOT_DIR / "bridges" / "hermes"
for p in (str(ROOT_DIR), str(BRIDGE_DIR)):
    if p not in sys.path:
        sys.path.insert(0, p)

import bridges.hermes as hermes_plugin
from bridges.hermes.native_engine import get_native_engine

PLUGIN_JS = ROOT_DIR / "desktop" / "plugin.js"
SHIPPED_DB = ROOT_DIR / "data" / "apple-docs.db"


def _js_block(src: str, start_marker: str, end_marker: str) -> str:
    """Slice a top-level JS declaration/function out of `plugin.js` verbatim."""
    start = src.index(start_marker)
    end = src.index(end_marker, start + len(start_marker))
    return src[start : end + len(end_marker)]


def _run_fallback_probe() -> dict:
    """Evaluate the real `FALLBACK_*` literals + `localSearchFallback` under Node."""
    src = PLUGIN_JS.read_text(encoding="utf-8")
    stats = _js_block(src, "const FALLBACK_STATS = {", "\n};")
    symbols = _js_block(src, "const FALLBACK_SYMBOLS = [", "\n];")
    idioms = _js_block(src, "const FALLBACK_IDIOMS = [", "\n];")
    fn = _js_block(src, "function localSearchFallback(query, framework) {", "\n}\n")

    parts = [
        stats,
        symbols,
        idioms,
        fn,
        "const zero = localSearchFallback('zzzz-no-such-symbol-zzzz', '');",
        "const zeroFramework = localSearchFallback('zzzz-no-such-symbol-zzzz', 'UIKit');",
        "const idiom = localSearchFallback('useEffect', '');",
        "const blank = localSearchFallback('', '');",
        "const good = localSearchFallback('NavigationSplitView', '');",
        "console.log(JSON.stringify({",
        "  stats: FALLBACK_STATS,",
        "  zero, zeroFramework, idiom, blank, good,",
        "  symbolTitles: FALLBACK_SYMBOLS.map((s) => s.title),",
        "}));",
    ]
    harness = "\n\n".join(parts)

    with tempfile.TemporaryDirectory() as tmp:
        harness_path = Path(tmp) / "fallback-probe.mjs"
        harness_path.write_text(harness, encoding="utf-8")
        proc = subprocess.run(
            ["node", str(harness_path)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
            cwd=str(ROOT_DIR),
        )
    if proc.returncode != 0:
        raise AssertionError(f"node fallback probe failed:\n{proc.stderr}\n{proc.stdout}")
    return json.loads(proc.stdout)


def _shipped_db_framework_counts() -> dict:
    conn = sqlite3.connect(f"file:{SHIPPED_DB}?mode=ro", uri=True)
    try:
        rows = conn.execute(
            "SELECT framework, COUNT(*) FROM symbols GROUP BY framework"
        ).fetchall()
        meta = dict(conn.execute("SELECT key, value FROM meta").fetchall())
    finally:
        conn.close()
    return {"frameworks": {name: count for name, count in rows}, "meta": meta}


@unittest.skipUnless(shutil.which("node"), "node is required to execute desktop/plugin.js")
class TestDesktopFallbackIntegrity(unittest.TestCase):
    """Audit item 1: honest fallback stats and no result substitution."""

    @classmethod
    def setUpClass(cls):
        cls.probe = _run_fallback_probe()
        cls.db = _shipped_db_framework_counts()
        cls.source = PLUGIN_JS.read_text(encoding="utf-8")

    def test_fallback_stats_report_zero_dense_vectors(self):
        stats = self.probe["stats"]
        self.assertEqual(stats["semanticItemCount"], 0)
        self.assertEqual(
            int(self.db["meta"].get("semantic_item_count") or 0),
            0,
            "shipped index must stay Rule 17-stripped for this assertion to hold",
        )

    def test_fallback_stats_match_shipped_index(self):
        stats = self.probe["stats"]
        db_counts = self.db["frameworks"]
        listed = {fw["name"]: fw["symbolCount"] for fw in stats["frameworks"]}

        self.assertEqual(stats["frameworkCount"], len(db_counts))
        self.assertEqual(len(stats["frameworks"]), len(db_counts))
        self.assertEqual(sum(listed.values()), stats["symbolCount"])
        self.assertEqual(stats["symbolCount"], int(self.db["meta"]["symbol_count"]))
        # Every shipped framework is present with its real symbol count.
        for name, count in db_counts.items():
            self.assertIn(name, listed, f"{name} missing from FALLBACK_STATS")
            self.assertEqual(listed[name], count, f"{name} count drifted from the shipped index")
        for name in listed:
            self.assertIn(name, db_counts, f"FALLBACK_STATS advertises non-existent framework {name}")

    def test_local_search_fallback_never_substitutes_results(self):
        zero = self.probe["zero"]
        self.assertEqual(zero["results"], [])
        self.assertEqual(zero["mode"], "offline-fallback")
        self.assertTrue(zero["offlineFallback"])
        self.assertIsInstance(zero["latencyMs"], (int, float))
        self.assertGreaterEqual(zero["latencyMs"], 0)
        self.assertNotEqual(zero["latencyMs"], 1.2, "latencyMs must be measured, not hardcoded")

        # Framework-filtered zero match must also stay empty (pool is non-empty there).
        zero_framework = self.probe["zeroFramework"]
        self.assertEqual(zero_framework["results"], [])
        self.assertEqual(zero_framework["mode"], "offline-fallback")

        self.assertNotIn(
            "pool.slice(0, 4)",
            self.source,
            "localSearchFallback must never fall back to unrelated default symbols",
        )

    def test_local_search_fallback_honest_modes(self):
        idiom = self.probe["idiom"]
        self.assertTrue(idiom["results"], "idiom query should match curated fallback symbols")
        self.assertEqual(idiom["mode"], "offline-fallback-idiom")
        self.assertTrue(idiom["offlineFallback"])
        self.assertNotEqual(idiom["mode"], "hybrid-idiom-rrf", "offline path must not mimic the live index mode")

        blank = self.probe["blank"]
        self.assertEqual(blank["mode"], "curated-preview")
        self.assertTrue(blank["offlineFallback"])
        self.assertEqual(len(blank["results"]), len(self.probe["symbolTitles"]))

        good = self.probe["good"]
        self.assertTrue(good["results"])
        self.assertNotEqual(good["mode"], "fts5-bm25", "offline path must not claim FTS5 BM25")


class TestCompilerDiagnosticHonesty(unittest.TestCase):
    """Audit item 2: fuzzy FTS5 hits are suggestions, never "Verified"."""

    ERROR_LOG = (
        "ContentView.swift:10:5: warning: 'NavigationView' was deprecated in iOS 16.0\n"
        "WebView.swift:14:9: error: cannot find 'WKNavigationDeleg' in scope\n"
        "WebView.swift:18:5: error: cannot find 'WKWebView' in scope\n"
    )

    @classmethod
    def setUpClass(cls):
        cls.engine = get_native_engine()
        cls.diag = cls.engine.diagnose_compiler_output("xcodebuild build", cls.ERROR_LOG, returncode=1)
        cls.by_symbol = {f["symbol"]: f for f in cls.diag["findings"]}

    def test_migration_stays_verified(self):
        finding = self.by_symbol["NavigationView"]
        self.assertEqual(finding["kind"], "migration")
        self.assertIn("deprecated", finding["reason"].lower())
        self.assertIn(
            "• `NavigationView` -> **NavigationStack / NavigationSplitView** (Verified Migration",
            self.diag["annotation"],
        )

    def test_fuzzy_fts_hit_is_labelled_suggestion(self):
        finding = self.by_symbol["WKNavigationDeleg"]
        self.assertEqual(finding["kind"], "docc-suggestion")
        self.assertTrue(
            finding["reason"].startswith("Closest DocC match:"),
            f"fuzzy hit must be described honestly, got: {finding['reason']!r}",
        )
        self.assertNotIn("Verified", finding["reason"])
        self.assertIn("Related FTS5 Suggestion", self.diag["annotation"])
        self.assertNotIn("`WKNavigationDeleg` ->", self.diag["annotation"])
        self.assertIn("`WKNavigationDeleg` ~?", self.diag["annotation"])

    def test_exact_fts_hit_is_labelled_exact_symbol(self):
        finding = self.by_symbol["WKWebView"]
        self.assertEqual(finding["kind"], "docc-exact")
        self.assertTrue(finding["reason"].startswith("Indexed "), finding["reason"])
        self.assertIn("(Exact Symbol · ", self.diag["annotation"])

    def test_only_migrations_claim_verified(self):
        for finding in self.diag["findings"]:
            if finding["kind"] == "migration":
                continue
            self.assertNotIn(
                "Verified",
                finding["reason"],
                f"{finding['symbol']} ({finding['kind']}) must not claim verification",
            )
        verified_lines = [ln for ln in self.diag["annotation"].splitlines() if "Verified" in ln]
        self.assertTrue(verified_lines)
        for line in verified_lines:
            self.assertIn("(Verified Migration", line)


class TestVersionAndIndexInfoAreDistinct(unittest.TestCase):
    """Audit item 3: `get_version` and `index_info` must not be aliases."""

    @classmethod
    def setUpClass(cls):
        cls.version_md = hermes_plugin._execute_tool("get_version", {})
        cls.index_md = hermes_plugin._execute_tool("index_info", {})

    def test_outputs_differ(self):
        self.assertNotEqual(self.version_md, self.index_md)

    def test_version_is_concise_identity(self):
        md = self.version_md
        self.assertIn("Engine v1.1.0", md)
        self.assertIn("95,899", md)
        self.assertIn("Runtime:", md)
        self.assertIn("not hydrated", md)
        self.assertIn("Latency:", md)
        self.assertNotIn("Per-Framework Symbol Counts", md)
        self.assertLess(len(md.splitlines()), 20, "get_version should stay a short identity probe")

    def test_index_info_has_detailed_breakdown(self):
        md = self.index_md
        self.assertIn("Apple Docs SQLite Index", md)
        self.assertIn("URI mode:", md)
        self.assertIn("read-only", md)
        self.assertIn("FTS5 status:", md)
        self.assertIn("Per-Framework Symbol Counts (30)", md)
        for framework, count in (("Swift", "18,442"), ("RealityKit", "6,235"), ("Observation", "37")):
            self.assertIn(f"| **{framework}** | {count} |", md)
        self.assertIn("semantic_item_count", md)
        self.assertIn("npm run download-vectors", md)
        self.assertIn("16 cross-framework idioms", md)

    def test_registered_handlers_route_to_distinct_formatters(self):
        from unittest.mock import MagicMock

        tools = {}
        ctx = MagicMock()
        ctx.tool = None
        ctx.get_config.side_effect = lambda key, default=None: default
        ctx.register_tool.side_effect = lambda name, schema=None, handler=None, toolset=None: tools.update(
            {name: handler}
        )
        hermes_plugin.register(ctx)
        self.assertIn("index_info", tools)
        self.assertNotEqual(tools["get_version"]({}), tools["index_info"]({}))

    def test_formatters_degrade_gracefully_without_an_index(self):
        from bridges.hermes.native_engine import AppleDocsNativeEngine

        with tempfile.TemporaryDirectory() as tmp:
            engine = AppleDocsNativeEngine(root_dir=Path(tmp))
            version_md = engine.format_version_markdown()
            index_md = engine.format_index_info_markdown()

        self.assertIn("Engine v1.1.0", version_md)
        self.assertIn("index unavailable", version_md)
        self.assertIn("no readable index at this path", index_md)
        self.assertIn("Per-Framework Symbol Counts (0)", index_md)
        self.assertNotEqual(version_md, index_md)


class TestSidebarNavPersistence(unittest.TestCase):
    """The `Apple Docs` sessions-sidebar row must outlive the docked Studio pane.

    Desktop app behaviour this pins: the `sidebar.nav` reader consumes `data`
    only (`path`/`label`/`codicon`/`tier`), while a contribution-level `path`
    (or `when()`) is a visibility gate. A route field sitting next to `area` is
    the exact shape that makes the row vanish as soon as the app is anywhere
    but `/apple-docs` — closing the docked pane is enough, since that row is
    the only way back into the Studio.
    """

    def _entry_head(self) -> str:
        src = PLUGIN_JS.read_text(encoding="utf-8")
        entry = _js_block(src, "id: 'sidebar-nav',", "render: () => jsx(AppleDocsSidePane")
        return entry.split("data:", 1)[0]

    def test_row_carries_no_contribution_level_route_field(self):
        head = self._entry_head()

        self.assertNotIn(
            "path:",
            head,
            "sidebar-nav must not carry a contribution-level `path`: route-scoped "
            "visibility hides the row off /apple-docs and strands the user",
        )
        self.assertNotIn(
            "when:",
            head,
            "sidebar-nav must not carry a `when()` gate — the row is the permanent "
            "way back into the Studio",
        )

    def test_row_is_not_advanced_tier_only(self):
        self.assertNotIn("tier: 'advanced'", self._entry_head())

    def test_destination_and_label_live_in_data(self):
        src = PLUGIN_JS.read_text(encoding="utf-8")
        entry = _js_block(src, "id: 'sidebar-nav',", "render: () => jsx(AppleDocsSidePane")

        self.assertIn("path: STUDIO_ROUTE", entry)
        self.assertIn("label: 'Apple Docs'", entry)
        self.assertIn("codicon: 'book'", entry)


class TestPaneOwnershipKeepsPluginAlive(unittest.TestCase):
    """Closing the docked Studio must never disable the whole plugin.

    Desktop `closeTreePane` behaviour this pins: a plugin that owns exactly ONE
    pane is treated as disposable — closing that pane calls
    `setPluginEnabled(pluginId, false)`, unregistering every contribution the
    plugin made (sidebar row, `/apple-docs` page, statusbar chip, palette
    commands). Owning a SECOND pane turns Close into a plain dismiss, which is
    the only plugin-side way to keep the Apple Docs entry point permanent.
    """

    def test_registers_more_than_one_pane(self):
        src = PLUGIN_JS.read_text(encoding="utf-8")
        panes_block = _js_block(src, "register(ctx) {", "\n\tdeactivate()")

        pane_ids = re.findall(r"area: PANES_AREA,\s*\n\t+title: '([^']+)'", panes_block)

        self.assertGreaterEqual(
            len(pane_ids),
            2,
            "a single-pane plugin is disabled outright when that pane is closed; "
            f"register at least two panes (found: {pane_ids})",
        )
        self.assertIn('inspector-pane', panes_block)
        self.assertIn('compiler-pane', panes_block)

    def test_second_pane_has_a_renderer(self):
        src = PLUGIN_JS.read_text(encoding="utf-8")

        self.assertIn("function AppleDocsCompilerPane(", src)
        self.assertIn("jsx(AppleDocsCompilerPane, { ctx })", src)


if __name__ == "__main__":
    unittest.main()
