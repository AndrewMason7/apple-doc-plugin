"""
Pure-Python Offline & Hybrid Apple Developer Documentation Engine for Hermes Agent.

Provides sub-5ms read-only SQLite FTS5 search over 95,899 Apple SDK symbols,
Cross-Framework Idiom Expansion (React / Web CSS / Android Kotlin -> SwiftUI & Swift 6),
Behavioral Intent Reciprocal Rank Fusion (RRF, k=60), Swift/Xcode Compiler Diagnostic
Grounding, and optional Apple DocC JSON AST extraction (https://developer.apple.com).

Zero third-party Python dependencies required (100% Python stdlib).
"""

from __future__ import annotations

import collections
import contextlib
import difflib
import json
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

PLUGIN_VERSION = "1.1.0"
DOCC_CDN_BASE = "https://developer.apple.com/tutorials/data"
DOCC_WEB_BASE = "https://developer.apple.com"

KIND_ALIASES: Dict[str, List[str]] = {
    "func": ["func", "function", "method", "instancemethod", "typemethod", "init", "initializer"],
    "function": ["func", "function", "method", "instancemethod", "typemethod"],
    "method": ["method", "instancemethod", "typemethod", "func"],
    "var": ["var", "property", "instanceproperty", "typeproperty"],
    "property": ["property", "instanceproperty", "typeproperty", "var"],
    "struct": ["struct", "structure"],
    "structure": ["struct", "structure"],
    "class": ["class"],
    "protocol": ["protocol"],
    "enum": ["enum", "enumeration"],
    "enumeration": ["enum", "enumeration"],
    "macro": ["macro"],
    "typealias": ["typealias"],
    "init": ["init", "initializer"],
}

CROSS_FRAMEWORK_IDIOMS: List[Dict[str, Any]] = [
    {
        "idiom": "useEffect",
        "ecosystem": "react",
        "category": "lifecycle",
        "appleSymbols": ["task(priority:_:)", "task(id:priority:_:)", "onAppear(perform:)", "onChange(of:initial:_:)", "onDisappear(perform:)"],
        "lookupTokens": ["task", "onAppear", "onChange", "onDisappear"],
        "frameworks": ["SwiftUI"],
        "description": "Structured async side-effects tied to view lifetime (auto-cancelled on disappear) and value observation.",
        "aliases": ["use_effect", "useeffect", "componentdidmount", "componentdidupdate", "launchedeffect", "disposableeffect"],
        "snippet": ".task(id: query) {\n    await viewModel.load(query)\n}",
    },
    {
        "idiom": "useState",
        "ecosystem": "react",
        "category": "state",
        "appleSymbols": ["State", "Binding", "Bindable"],
        "lookupTokens": ["State", "Binding", "Bindable"],
        "frameworks": ["SwiftUI"],
        "description": "Value-type view-local state and two-way child bindings in SwiftUI.",
        "aliases": ["use_state", "usestate", "mutablestateof", "remember"],
        "snippet": "@State private var isPresented = false",
    },
    {
        "idiom": "useContext",
        "ecosystem": "react",
        "category": "state",
        "appleSymbols": ["Environment", "EnvironmentValues", "Entry"],
        "lookupTokens": ["Environment", "EnvironmentValues"],
        "frameworks": ["SwiftUI"],
        "description": "Dependency injection down the SwiftUI view hierarchy via @Environment and @Entry.",
        "aliases": ["use_context", "usecontext", "compositionlocal", "provide", "inject"],
        "snippet": "@Environment(\\.colorScheme) private var colorScheme",
    },
    {
        "idiom": "Redux / Zustand",
        "ecosystem": "react",
        "category": "state",
        "appleSymbols": ["Observable", "Bindable", "ObservableObject"],
        "lookupTokens": ["Observable", "Bindable", "ObservableObject"],
        "frameworks": ["Observation", "SwiftUI"],
        "description": "Fine-grained property-level reactive stores using Swift's @Observable macro (zero @Published boilerplate).",
        "aliases": ["redux", "zustand", "mobx", "vuex", "pinia", "viewmodel", "stateflow", "livedata"],
        "snippet": "@Observable final class AppStore {\n    var items: [Item] = []\n}",
    },
    {
        "idiom": "SharedPreferences / localStorage",
        "ecosystem": "android",
        "category": "storage",
        "appleSymbols": ["AppStorage", "SceneStorage", "UserDefaults"],
        "lookupTokens": ["AppStorage", "SceneStorage", "UserDefaults"],
        "frameworks": ["SwiftUI", "Foundation"],
        "description": "Reactive UserDefaults-backed lightweight key-value persistence.",
        "aliases": ["sharedpreferences", "shared_preferences", "shared preferences", "localstorage", "local_storage", "sessionstorage", "asyncstorage", "async_storage", "datastore"],
        "snippet": "@AppStorage(\"hasCompletedOnboarding\") private var onboarded = false",
    },
    {
        "idiom": "Room / Prisma / SQLite ORM",
        "ecosystem": "android",
        "category": "storage",
        "caseSensitive": True,
        "appleSymbols": ["Model", "ModelContainer", "ModelContext", "Query"],
        "lookupTokens": ["ModelContainer", "ModelContext", "Query", "SwiftData"],
        "frameworks": ["SwiftData", "CoreData"],
        "description": "Declarative Swift-native object persistence, schema migration, and reactive @Query views.",
        "aliases": ["room database", "room db", "android room", "sqliteopenhelper", "typeorm", "indexeddb"],
        "snippet": "@Model final class Trip {\n    var destination: String\n    var startDate: Date\n}",
    },
    {
        "idiom": "CSS Flexbox (display: flex)",
        "ecosystem": "web",
        "category": "layout",
        "appleSymbols": ["HStack", "VStack", "ZStack", "Spacer", "ViewThatFits", "Layout"],
        "lookupTokens": ["HStack", "VStack", "ZStack", "Spacer", "Layout"],
        "frameworks": ["SwiftUI"],
        "description": "Directional stack containers, flexible spacers, and custom Layout protocol composition.",
        "aliases": ["flexbox", "display: flex", "display flex", "css flex", "flex-direction", "justify-content", "align-items"],
        "snippet": "HStack(alignment: .center, spacing: 12) {\n    Text(title)\n    Spacer()\n}",
    },
    {
        "idiom": "CSS Grid (display: grid)",
        "ecosystem": "web",
        "category": "layout",
        "appleSymbols": ["Grid", "GridRow", "LazyVGrid", "LazyHGrid", "GridItem"],
        "lookupTokens": ["Grid", "GridRow", "LazyVGrid", "LazyHGrid", "GridItem"],
        "frameworks": ["SwiftUI"],
        "description": "Two-dimensional eager Grid and viewport-virtualized LazyVGrid / LazyHGrid.",
        "aliases": ["css grid", "display: grid", "display grid", "grid-template-columns"],
        "snippet": "LazyVGrid(columns: [GridItem(.adaptive(minimum: 160))]) {\n    ForEach(items) { CardView(item: $0) }\n}",
    },
    {
        "idiom": "RecyclerView / FlatList",
        "ecosystem": "android",
        "category": "ui",
        "appleSymbols": ["List", "LazyVStack", "ScrollView", "ForEach"],
        "lookupTokens": ["List", "LazyVStack", "ScrollView", "ForEach"],
        "frameworks": ["SwiftUI"],
        "description": "Cell-reusing swipeable List and lazy scrollable stacks.",
        "aliases": ["recyclerview", "recycler view", "flatlist", "lazycolumn", "virtualizedlist"],
        "snippet": "List(items) { item in\n    RowView(item: item)\n}",
    },
    {
        "idiom": "React Router / NavController",
        "ecosystem": "react",
        "category": "navigation",
        "appleSymbols": ["NavigationStack", "NavigationSplitView", "NavigationPath", "navigationDestination(for:destination:)"],
        "lookupTokens": ["NavigationStack", "NavigationSplitView", "NavigationPath", "navigationDestination"],
        "frameworks": ["SwiftUI"],
        "description": "Type-safe value-driven navigation stacks and multi-column iPad/macOS split views.",
        "aliases": ["react router", "react-router", "navcontroller", "navigation-compose", "vue-router", "nextjs router"],
        "snippet": "NavigationStack(path: $path) {\n    HomeView()\n        .navigationDestination(for: Route.self) { route in ... }\n}",
    },
    {
        "idiom": "Modal / BottomSheet / Dialog",
        "ecosystem": "web",
        "category": "ui",
        "appleSymbols": ["sheet(isPresented:onDismiss:content:)", "presentationDetents(_:)", "interactiveDismissDisabled(_:)", "popover(isPresented:attachmentAnchor:arrowEdge:content:)", "confirmationDialog(_:isPresented:titleVisibility:actions:)"],
        "lookupTokens": ["sheet", "presentationDetents", "interactiveDismissDisabled", "popover", "confirmationDialog"],
        "frameworks": ["SwiftUI"],
        "description": "Resizable detent sheets, non-dismissible modals, popovers, and action sheets.",
        "aliases": ["modal dialog", "bottomsheet", "bottom sheet", "modal sheet", "dialog", "snackbar", "toast"],
        "snippet": ".sheet(isPresented: $showSheet) {\n    DetailSheet()\n        .presentationDetents([.medium, .large])\n        .interactiveDismissDisabled()\n}",
    },
    {
        "idiom": "Kotlin Coroutines / Promise.all",
        "ecosystem": "android",
        "category": "concurrency",
        "appleSymbols": ["Task", "TaskGroup", "withThrowingTaskGroup(of:returning:body:)", "AsyncStream", "MainActor"],
        "lookupTokens": ["Task", "TaskGroup", "withThrowingTaskGroup", "AsyncStream", "MainActor"],
        "frameworks": ["Swift", "SwiftUI"],
        "description": "Swift 6 structured concurrency, actor isolation, and parallel child tasks.",
        "aliases": ["coroutine", "coroutines", "suspend fun", "promise.all", "web worker", "dispatchers.io"],
        "snippet": "await withThrowingTaskGroup(of: Data.self) { group in\n    for url in urls { group.addTask { try await fetch(url) } }\n}",
    },
    {
        "idiom": "fetch / Axios / Retrofit",
        "ecosystem": "web",
        "category": "networking",
        "appleSymbols": ["URLSession", "URLRequest", "URLComponents", "JSONDecoder"],
        "lookupTokens": ["URLSession", "URLRequest", "URLComponents", "JSONDecoder"],
        "frameworks": ["Foundation"],
        "description": "Async/await HTTP requests, streaming bytes, and Codable JSON decoding via URLSession.",
        "aliases": ["axios", "retrofit", "okhttp", "xmlhttprequest", "ky"],
        "snippet": "let (data, _) = try await URLSession.shared.data(from: url)\nlet model = try JSONDecoder().decode(Response.self, from: data)",
    },
    {
        "idiom": "WorkManager / Cron / Service Worker",
        "ecosystem": "android",
        "category": "concurrency",
        "appleSymbols": ["BGTaskScheduler", "BGAppRefreshTask", "BGProcessingTask"],
        "lookupTokens": ["BGTaskScheduler", "BGAppRefreshTask", "BGProcessingTask"],
        "frameworks": ["Foundation", "UIKit"],
        "description": "System-scheduled background refresh andopportunistic processing tasks.",
        "aliases": ["workmanager", "work_manager", "jobscheduler", "background service"],
        "snippet": "BGTaskScheduler.shared.register(forTaskWithIdentifier: id, using: nil) { task in ... }",
    },
    {
        "idiom": "WebAuthn / BiometricPrompt",
        "ecosystem": "web",
        "category": "security",
        "appleSymbols": ["LAContext", "ASAuthorizationAppleIDProvider", "ASAuthorizationPlatformPublicKeyCredentialProvider"],
        "lookupTokens": ["LAContext", "ASAuthorizationAppleIDProvider", "SecItemAdd"],
        "frameworks": ["LocalAuthentication", "AuthenticationServices", "Security"],
        "description": "Face ID / Touch ID evaluation, Passkeys, Sign in with Apple, and Keychain Services.",
        "aliases": ["biometricprompt", "faceid", "face id", "touch id", "webauthn", "passkey", "oauth login"],
        "snippet": "let context = LAContext()\ntry await context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason)",
    },
    {
        "idiom": "Stripe / Google Play Billing",
        "ecosystem": "general",
        "category": "commerce",
        "appleSymbols": ["Product", "Transaction", "SubscriptionStoreView", "StoreView"],
        "lookupTokens": ["Product", "Transaction", "SubscriptionStoreView", "StoreView"],
        "frameworks": ["StoreKit"],
        "description": "StoreKit 2 async product loading, JWS-verified transactions, and SwiftUI subscription paywalls.",
        "aliases": ["play billing", "billingclient", "in-app purchase", "iap", "paywall"],
        "snippet": "SubscriptionStoreView(groupID: \"pro_tier\")",
    },
]

BEHAVIORAL_INTENTS: List[Tuple[List[str], List[str], Optional[str]]] = [
    (["sheet", "dismiss"], ["interactiveDismissDisabled", "presentationDetents", "dismiss"], "SwiftUI"),
    (["swipe", "sheet"], ["interactiveDismissDisabled", "sheet"], "SwiftUI"),
    (["drag", "sheet"], ["interactiveDismissDisabled", "presentationDragIndicator"], "SwiftUI"),
    (["dismiss", "keyboard"], ["scrollDismissesKeyboardMode", "FocusState", "focused"], "SwiftUI"),
    (["hide", "keyboard"], ["scrollDismissesKeyboardMode", "FocusState", "resignFirstResponder"], None),
    (["three", "column"], ["NavigationSplitView", "NavigationSplitViewVisibility"], "SwiftUI"),
    (["split", "view"], ["NavigationSplitView", "UISplitViewController", "NSSplitViewController"], None),
    (["screen", "appears"], ["onAppear", "task", "viewIsAppearing", "viewDidAppear"], None),
    (["pull", "refresh"], ["refreshable", "UIRefreshControl"], None),
    (["search", "bar"], ["searchable", "searchScopes", "UISearchController"], None),
    (["keychain", "password"], ["SecItemAdd", "SecItemCopyMatching", "SecItemUpdate"], "Security"),
    (["keychain"], ["SecItemAdd", "SecItemCopyMatching", "SecItemDelete"], "Security"),
    (["face", "id"], ["LAContext", "LAPolicy"], "LocalAuthentication"),
    (["touch", "id"], ["LAContext", "LAPolicy"], "LocalAuthentication"),
    (["recognize", "text"], ["VNRecognizeTextRequest", "VNImageRequestHandler"], "Vision"),
    (["ocr"], ["VNRecognizeTextRequest"], "Vision"),
    (["share", "sheet"], ["ShareLink", "UIActivityViewController"], None),
    (["haptic"], ["sensoryFeedback", "UIImpactFeedbackGenerator"], None),
]

SWIFT_COMPILER_MIGRATIONS: Dict[str, Dict[str, str]] = {
    "NavigationView": {
        "replacement": "NavigationStack / NavigationSplitView",
        "lookup": "NavigationStack",
        "framework": "SwiftUI",
        "reason": "NavigationView was deprecated in iOS 16.0 / macOS 13.0. Use NavigationStack for push routing or NavigationSplitView for multi-column layouts.",
        "fix": "NavigationStack {\n    ContentView()\n        .navigationDestination(for: Item.self) { item in DetailView(item: item) }\n}",
    },
    "navigationBarItems": {
        "replacement": "toolbar(content:) + ToolbarItem",
        "lookup": "ToolbarItem",
        "framework": "SwiftUI",
        "reason": ".navigationBarItems(leading:trailing:) is deprecated. Use .toolbar { ToolbarItem(placement: .topBarTrailing) { ... } }.",
        "fix": ".toolbar {\n    ToolbarItem(placement: .confirmationAction) {\n        Button(\"Save\", action: save)\n    }\n}",
    },
    "navigationBarTitle": {
        "replacement": "navigationTitle(_:) + navigationBarTitleDisplayMode(_:)",
        "lookup": "navigationTitle",
        "framework": "SwiftUI",
        "reason": ".navigationBarTitle is deprecated in favor of .navigationTitle(_:).",
        "fix": ".navigationTitle(\"Settings\")",
    },
    "foregroundColor": {
        "replacement": "foregroundStyle(_:)",
        "lookup": "foregroundStyle",
        "framework": "SwiftUI",
        "reason": ".foregroundColor(_:) was deprecated in iOS 17.0 / macOS 14.0. Prefer .foregroundStyle(_:) which supports hierarchical styles and gradients.",
        "fix": ".foregroundStyle(.secondary)",
    },
    "cornerRadius": {
        "replacement": "clipShape(.rect(cornerRadius:))",
        "lookup": "clipShape",
        "framework": "SwiftUI",
        "reason": ".cornerRadius(_:) was deprecated in iOS 17.0 / macOS 14.0. Use .clipShape(.rect(cornerRadius: 12)).",
        "fix": ".clipShape(.rect(cornerRadius: 12, style: .continuous))",
    },
    "accentColor": {
        "replacement": "tint(_:)",
        "lookup": "tint",
        "framework": "SwiftUI",
        "reason": ".accentColor(_:) is deprecated. Use .tint(_:) across SwiftUI controls and navigation.",
        "fix": ".tint(.blue)",
    },
    "presentationMode": {
        "replacement": "@Environment(\\.dismiss)",
        "lookup": "DismissAction",
        "framework": "SwiftUI",
        "reason": "@Environment(\\.presentationMode) is deprecated. Inject @Environment(\\.dismiss) private var dismiss and call dismiss().",
        "fix": "@Environment(\\.dismiss) private var dismiss",
    },
    "ObservableObject": {
        "replacement": "@Observable (Observation framework)",
        "lookup": "Observable",
        "framework": "Observation",
        "reason": "On iOS 17+ / macOS 14+, prefer @Observable and @Bindable over Combine's ObservableObject + @Published to avoid unnecessary whole-view invalidations.",
        "fix": "import Observation\n\n@Observable final class ViewModel {\n    var count = 0\n}",
    },
    "StateObject": {
        "replacement": "@State with @Observable class",
        "lookup": "Observable",
        "framework": "Observation",
        "reason": "With @Observable classes (iOS 17+), hold owned model instances using @State private var model = ViewModel() instead of @StateObject.",
        "fix": "@State private var viewModel = ViewModel()",
    },
    "UIAlertView": {
        "replacement": "UIAlertController / SwiftUI .alert(_:isPresented:actions:)",
        "lookup": "UIAlertController",
        "framework": "UIKit",
        "reason": "UIAlertView is long-removed/deprecated. Use UIAlertController in UIKit or .alert(...) in SwiftUI.",
        "fix": ".alert(\"Title\", isPresented: $showAlert) {\n    Button(\"OK\", role: .cancel) {}\n}",
    },
    "onChange": {
        "replacement": "onChange(of:initial:_:) two-parameter or zero-parameter closure",
        "lookup": "onChange",
        "framework": "SwiftUI",
        "reason": "Single-parameter .onChange(of:) { newValue in } was deprecated in iOS 17.0. Use { oldValue, newValue in } or { }.",
        "fix": ".onChange(of: selection) { oldValue, newValue in\n    handleSelection(newValue)\n}",
    },
}

_DIAG_PATTERNS = [
    re.compile(r"'([A-Za-z_][A-Za-z0-9_.:()]*)'\s+was deprecated"),
    re.compile(r"'([A-Za-z_][A-Za-z0-9_.:()]*)'\s+is unavailable"),
    re.compile(r"has no member\s+'([A-Za-z_][A-Za-z0-9_]*)'"),
    re.compile(r"[Cc]annot find (?:type )?'([A-Za-z_][A-Za-z0-9_]*)' in scope"),
    re.compile(r"[Nn]o exact matches in call to (?:instance |static |initializer )?(?:method )?'([A-Za-z_][A-Za-z0-9_]*)'"),
]


def _parse_platforms(raw: Any) -> List[str]:
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                return [str(x) for x in parsed]
        except ValueError:
            return [p.strip() for p in raw.split(",") if p.strip()]
    return []


def _format_inline_docc(nodes: Any) -> str:
    if not isinstance(nodes, list):
        return ""
    parts: List[str] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        ntype = node.get("type")
        if ntype == "text":
            parts.append(str(node.get("text") or ""))
        elif ntype == "codeVoice":
            parts.append(f"`{node.get('code') or ''}`")
        elif ntype == "reference":
            ident = str(node.get("identifier") or "")
            title = node.get("title") or (ident.rsplit("/", 1)[-1].replace("-", " ") if ident else "symbol")
            parts.append(f"`{title}`")
        elif ntype == "emphasis":
            parts.append(f"*{_format_inline_docc(node.get('inlineContent'))}*")
        elif ntype == "strong":
            parts.append(f"**{_format_inline_docc(node.get('inlineContent'))}**")
        elif ntype == "link":
            title = node.get("title") or node.get("destination") or "Link"
            dest = node.get("destination") or ""
            parts.append(f"[{title}]({dest})")
        elif "inlineContent" in node:
            parts.append(_format_inline_docc(node.get("inlineContent")))
    return "".join(parts)


def _format_docc_blocks(nodes: Any, max_paragraphs: int = 6) -> str:
    if not isinstance(nodes, list):
        return ""
    out: List[str] = []
    for node in nodes:
        if len(out) >= max_paragraphs:
            break
        if not isinstance(node, dict):
            continue
        ntype = node.get("type")
        if ntype == "paragraph":
            txt = _format_inline_docc(node.get("inlineContent")).strip()
            if txt:
                out.append(txt)
        elif ntype == "heading":
            lvl = min(max(int(node.get("level") or 2), 2), 5)
            out.append(f"{'#' * lvl} {node.get('text') or ''}".strip())
        elif ntype == "codeListing":
            lang = node.get("syntax") or "swift"
            code_lines = node.get("code") or []
            code = "\n".join(str(x) for x in code_lines) if isinstance(code_lines, list) else str(code_lines)
            if code.strip():
                out.append(f"```{lang}\n{code}\n```")
        elif ntype in ("unorderedList", "orderedList") and isinstance(node.get("items"), list):
            lines = []
            for idx, item in enumerate(node["items"][:8]):
                body = _format_docc_blocks(item.get("content") if isinstance(item, dict) else [], max_paragraphs=2).strip()
                if body:
                    prefix = f"{idx + 1}." if ntype == "orderedList" else "-"
                    lines.append(f"{prefix} {body}")
            if lines:
                out.append("\n".join(lines))
        elif ntype == "aside":
            style = str(node.get("style") or "NOTE").upper()
            body = _format_docc_blocks(node.get("content"), max_paragraphs=2).strip()
            if body:
                quoted = body.replace("\n", "\n> ")
                out.append(f"> [!{style}]\n> {quoted}")
    return "\n\n".join(out)


def expand_idioms(query: str) -> Dict[str, Any]:
    trimmed = (query or "").strip()
    if not trimmed:
        return {
            "originalQuery": "",
            "matchedIdioms": [],
            "mappedSymbols": [],
            "lookupTokens": [],
            "frameworks": [],
            "hasExpansion": False,
        }
    lower = trimmed.lower()
    clean = re.sub(r"[^a-z0-9_]+", " ", lower).strip()
    matched: List[Dict[str, Any]] = []
    mapped_symbols: List[str] = []
    lookup_tokens: List[str] = []
    frameworks: List[str] = []

    for entry in CROSS_FRAMEWORK_IDIOMS:
        candidates = [entry["idiom"], *(entry.get("aliases") or [])]
        hit = False
        for term in candidates:
            norm = term.lower()
            if " " not in norm and ":" not in norm and "/" not in norm:
                cs = bool(entry.get("caseSensitive")) and any(c.isupper() for c in term)
                pat = rf"(?:^|\b|\W){re.escape(term if cs else norm)}(?:\b|\W|$)"
                if re.search(pat, trimmed if cs else lower):
                    hit = True
                    break
            else:
                norm_phrase = re.sub(r"[^a-z0-9_]+", " ", norm).strip()
                if norm in lower or (norm_phrase and norm_phrase in clean):
                    hit = True
                    break
        if hit:
            matched.append(entry)
            for sym in entry.get("appleSymbols", []):
                if sym not in mapped_symbols:
                    mapped_symbols.append(sym)
            for tok in entry.get("lookupTokens", []):
                if tok not in lookup_tokens:
                    lookup_tokens.append(tok)
            for fw in entry.get("frameworks", []):
                if fw not in frameworks:
                    frameworks.append(fw)

    words = set(clean.split())
    for required_words, intent_tokens, intent_fw in BEHAVIORAL_INTENTS:
        if all(w in words or w in lower for w in required_words):
            for tok in intent_tokens:
                if tok not in lookup_tokens:
                    lookup_tokens.append(tok)
                if tok not in mapped_symbols:
                    mapped_symbols.append(tok)
            if intent_fw and intent_fw not in frameworks:
                frameworks.append(intent_fw)

    return {
        "originalQuery": trimmed,
        "matchedIdioms": matched,
        "mappedSymbols": mapped_symbols,
        "lookupTokens": lookup_tokens,
        "frameworks": frameworks,
        "hasExpansion": bool(matched or lookup_tokens),
    }


class AppleDocsNativeEngine:
    """Thread-safe, sub-5ms Python SQLite FTS5 + DocC engine."""

    def __init__(self, root_dir: Optional[Path] = None, db_path: Optional[Path] = None) -> None:
        self.root_dir = (root_dir or Path(__file__).resolve().parents[2]).resolve()
        self._explicit_db_path = Path(db_path).resolve() if db_path else None
        self._docc_cache: "collections.OrderedDict[str, Dict[str, Any]]" = collections.OrderedDict()
        self._cache_lock = threading.Lock()
        self._stats_cache: Optional[Tuple[float, Dict[str, Any]]] = None

    @property
    def db_path(self) -> Path:
        if self._explicit_db_path and self._explicit_db_path.exists():
            return self._explicit_db_path
        runtime_db = self.root_dir / "data" / "apple-docs.runtime.db"
        if runtime_db.exists():
            return runtime_db
        return self.root_dir / "data" / "apple-docs.db"

    def _connect(self) -> contextlib.AbstractContextManager[sqlite3.Connection]:
        target = self.db_path
        if not target.exists():
            raise FileNotFoundError(f"Apple Docs SQLite index not found at {target}")
        uri = f"file:{urllib.parse.quote(str(target))}?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=5.0)
        conn.row_factory = sqlite3.Row
        return contextlib.closing(conn)

    def has_hydrated_vectors(self) -> bool:
        try:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT value FROM meta WHERE key = 'semantic_item_count'"
                ).fetchone()
                return bool(row and int(row["value"] or "0") > 0)
        except Exception:
            return False

    def get_index_stats(self) -> Dict[str, Any]:
        now = time.monotonic()
        if self._stats_cache and (now - self._stats_cache[0]) < 30.0:
            return self._stats_cache[1]

        t0 = time.perf_counter()
        target = self.db_path
        if not target.exists():
            return {
                "ok": False,
                "version": PLUGIN_VERSION,
                "symbolCount": 0,
                "frameworkCount": 0,
                "frameworks": [],
                "mode": "unavailable",
                "dbPath": str(target),
            }

        with self._connect() as conn:
            meta = {
                r["key"]: r["value"]
                for r in conn.execute("SELECT key, value FROM meta").fetchall()
            }
            fw_rows = conn.execute(
                "SELECT framework, COUNT(*) AS count FROM symbols GROUP BY framework ORDER BY count DESC"
            ).fetchall()
            total = sum(int(r["count"]) for r in fw_rows) or int(meta.get("symbol_count") or 0)
            sem_count = int(meta.get("semantic_item_count") or 0)

        frameworks = [{"name": r["framework"], "symbolCount": int(r["count"])} for r in fw_rows]
        mode = "hybrid-768d" if sem_count > 0 else "hybrid-idiom-fts5"
        stats = {
            "ok": True,
            "version": PLUGIN_VERSION,
            "engine": "hermes-native-sqlite-fts5",
            "symbolCount": total,
            "semanticItemCount": sem_count,
            "frameworkCount": len(frameworks),
            "frameworks": frameworks,
            "builtAt": meta.get("built_at") or meta.get("repaired_at") or "",
            "mode": mode,
            "idiomCount": len(CROSS_FRAMEWORK_IDIOMS),
            "compilerRuleCount": len(SWIFT_COMPILER_MIGRATIONS),
            "latencyMs": round((time.perf_counter() - t0) * 1000, 2),
        }
        self._stats_cache = (now, stats)
        return stats

    def format_version_markdown(self) -> str:
        st = self.get_index_stats()
        top_fw = ", ".join(f"{f['name']} ({f['symbolCount']:,})" for f in st.get("frameworks", [])[:8])
        return (
            f"# Apple Developer Documentation Engine v{st['version']}\n\n"
            f"- **Indexed Symbols:** {st['symbolCount']:,} offline symbols\n"
            f"- **Indexed Frameworks:** {st['frameworkCount']} ({top_fw}, ...)\n"
            f"- **Search Engine:** `{st['mode']}` ({st['idiomCount']} cross-framework idioms + SQLite FTS5 BM25)\n"
            f"- **Dense Vectors Hydrated:** {st['semanticItemCount']:,}\n"
            f"- **Index Built At:** `{st.get('builtAt') or 'bundled'}`\n"
            f"- **Query Latency:** `{st.get('latencyMs', 0)} ms`\n"
        )

    def discover_technologies_data(
        self, query: str = "", page: int = 1, page_size: int = 25
    ) -> Dict[str, Any]:
        st = self.get_index_stats()
        fws = st.get("frameworks", [])
        q = (query or "").strip().lower()
        if q:
            fws = [f for f in fws if q in f["name"].lower()]
        page = max(int(page or 1), 1)
        page_size = min(max(int(page_size or 25), 1), 100)
        start = (page - 1) * page_size
        sliced = fws[start : start + page_size]
        return {
            "total": len(fws),
            "page": page,
            "pageSize": page_size,
            "totalSymbols": st.get("symbolCount", 0),
            "technologies": sliced,
        }

    def format_discover_markdown(self, query: str = "", page: int = 1, page_size: int = 25) -> str:
        data = self.discover_technologies_data(query=query, page=page, page_size=page_size)
        lines = [
            f"# Indexed Apple Frameworks ({data['total']} matching · {data['totalSymbols']:,} total symbols)",
            "",
            "| Framework | Offline Symbols | DocC Root |",
            "| :--- | ---: | :--- |",
        ]
        for item in data["technologies"]:
            lines.append(
                f"| **{item['name']}** | {item['symbolCount']:,} | `/documentation/{item['name'].lower()}` |"
            )
        return "\n".join(lines)

    def _row_to_item(self, row: sqlite3.Row, source: str = "lexical", score: float = 0.0) -> Dict[str, Any]:
        platforms = _parse_platforms(row["platforms"])
        return {
            "id": row["id"],
            "title": row["title"],
            "framework": row["framework"],
            "kind": row["kind"],
            "abstract": row["abstract"] or "",
            "path": row["path"],
            "platforms": platforms,
            "isPrimaryType": bool(row["is_primary_type"]),
            "source": source,
            "score": round(float(score), 4),
            "webUrl": f"{DOCC_WEB_BASE}{row['path']}",
        }

    def _apply_filters_sql(
        self,
        framework: Optional[str],
        platform: Optional[str],
        symbol_type: Optional[str],
        alias: str = "s",
    ) -> Tuple[List[str], List[Any]]:
        clauses: List[str] = []
        params: List[Any] = []
        if framework and framework.strip():
            clauses.append(f"LOWER({alias}.framework) = LOWER(?)")
            params.append(framework.strip())
        if platform and platform.strip():
            clauses.append(f"LOWER({alias}.platforms) LIKE ?")
            params.append(f"%{platform.strip().lower()}%")
        if symbol_type and symbol_type.strip():
            st_key = symbol_type.strip().lower()
            kinds = KIND_ALIASES.get(st_key, [st_key])
            placeholders = ", ".join("?" for _ in kinds)
            clauses.append(f"LOWER({alias}.kind) IN ({placeholders})")
            params.extend(kinds)
        return clauses, params

    def search_symbols_data(
        self,
        query: str,
        framework: Optional[str] = None,
        platform: Optional[str] = None,
        symbol_type: Optional[str] = None,
        max_results: int = 20,
    ) -> Dict[str, Any]:
        t0 = time.perf_counter()
        raw_q = (query or "").strip()
        limit = min(max(int(max_results or 20), 1), 100)
        if not raw_q:
            return {"query": "", "mode": "lexical", "latencyMs": 0.0, "results": []}

        clean_bare = raw_q.lstrip("@").split("(", 1)[0].strip()
        has_wildcard = "*" in raw_q or "?" in raw_q
        clauses, filter_params = self._apply_filters_sql(framework, platform, symbol_type, alias="s")
        where_extra = (" AND " + " AND ".join(clauses)) if clauses else ""

        results: List[Dict[str, Any]] = []
        seen_ids: set[str] = set()

        with self._connect() as conn:
            if has_wildcard:
                like_pat = raw_q.replace("%", "\\%").replace("_", "\\_").replace("*", "%").replace("?", "_")
                sql = f"""
                    SELECT s.id, s.framework, s.title, s.kind, s.abstract, s.path, s.platforms, s.is_primary_type
                    FROM symbols s
                    WHERE s.title LIKE ? ESCAPE '\\' {where_extra}
                    ORDER BY s.is_primary_type DESC, LENGTH(s.title) ASC
                    LIMIT ?
                """
                for row in conn.execute(sql, [like_pat, *filter_params, limit]).fetchall():
                    if row["id"] not in seen_ids:
                        seen_ids.add(row["id"])
                        results.append(self._row_to_item(row, source="wildcard", score=1.0))
            else:
                tokens = [re.sub(r"[^A-Za-z0-9_]", "", t) for t in re.split(r"\s+", raw_q)]
                tokens = [t for t in tokens if len(t) >= 2]
                bare_alnum = re.sub(r"[^A-Za-z0-9_]", "", clean_bare)
                if bare_alnum and bare_alnum not in tokens:
                    tokens.insert(0, bare_alnum)

                if tokens:
                    fts_expr = " OR ".join(f'"{t}"*' for t in tokens[:6])
                    fts_sql = f"""
                        SELECT s.id, s.framework, s.title, s.kind, s.abstract, s.path, s.platforms, s.is_primary_type,
                               bm25(symbols_fts, 10.0, 2.5, 1.0, 2.0) AS rank_score
                        FROM symbols_fts
                        JOIN symbols s ON s.rowid = symbols_fts.rowid
                        WHERE symbols_fts MATCH ? {where_extra}
                        ORDER BY
                            CASE
                                WHEN LOWER(s.title) = LOWER(?) THEN 0
                                WHEN LOWER(s.title) LIKE LOWER(?) THEN 1
                                WHEN LOWER(s.title) LIKE LOWER(?) THEN 2
                                ELSE 3
                            END ASC,
                            (bm25(symbols_fts, 10.0, 2.5, 1.0, 2.0) - (s.is_primary_type * 4.0)) ASC
                        LIMIT ?
                    """
                    for row in conn.execute(
                        fts_sql,
                        [
                            fts_expr,
                            *filter_params,
                            clean_bare,
                            f"{clean_bare}(%",
                            f"func {clean_bare}(%",
                            limit * 2,
                        ],
                    ).fetchall():
                        if row["id"] not in seen_ids:
                            seen_ids.add(row["id"])
                            t_low = (row["title"] or "").lower()
                            cb_low = clean_bare.lower()
                            is_exact = (
                                t_low == cb_low
                                or t_low.startswith(f"{cb_low}(")
                                or t_low.startswith(f"func {cb_low}(")
                                or t_low.startswith(f"var {cb_low}:")
                            )
                            src = "exact" if is_exact else "fts5"
                            sc = 2.0 if is_exact else abs(float(row["rank_score"] or 0.0))
                            results.append(self._row_to_item(row, source=src, score=sc))
                            if len(results) >= limit:
                                break

        return {
            "query": raw_q,
            "mode": "wildcard" if has_wildcard else "fts5-bm25",
            "latencyMs": round((time.perf_counter() - t0) * 1000, 2),
            "count": len(results[:limit]),
            "results": results[:limit],
        }

    def semantic_search_data(
        self,
        query: str,
        framework: Optional[str] = None,
        platform: Optional[str] = None,
        symbol_type: Optional[str] = None,
        max_results: int = 20,
    ) -> Dict[str, Any]:
        """Hybrid Cross-Framework Idiom + Behavioral Intent + FTS5 Reciprocal Rank Fusion (k=60)."""
        t0 = time.perf_counter()
        raw_q = (query or "").strip()
        limit = min(max(int(max_results or 20), 1), 100)
        if not raw_q:
            return {"query": "", "mode": "hybrid-idiom-rrf", "latencyMs": 0.0, "expansion": {}, "results": []}

        expansion = expand_idioms(raw_q)
        rrf_scores: Dict[str, float] = collections.defaultdict(float)
        items_by_id: Dict[str, Dict[str, Any]] = {}
        sources_by_id: Dict[str, set[str]] = collections.defaultdict(set)
        k_rrf = 60.0

        if expansion["lookupTokens"]:
            for rank_group_idx, token in enumerate(expansion["lookupTokens"][:6]):
                sub = self.search_symbols_data(
                    query=token,
                    framework=framework,
                    platform=platform,
                    symbol_type=symbol_type,
                    max_results=8,
                )
                weight = 1.35 if rank_group_idx < 3 else 1.0
                for idx, item in enumerate(sub["results"]):
                    sid = item["id"]
                    rrf_scores[sid] += weight * (1.0 / (k_rrf + idx + 1))
                    items_by_id.setdefault(sid, item)
                    sources_by_id[sid].add("idiom-bridge")

        lex = self.search_symbols_data(
            query=raw_q,
            framework=framework,
            platform=platform,
            symbol_type=symbol_type,
            max_results=limit * 2,
        )
        for idx, item in enumerate(lex["results"]):
            sid = item["id"]
            boost = 1.5 if item.get("source") == "exact" else 1.0
            rrf_scores[sid] += boost * (1.0 / (k_rrf + idx + 1))
            items_by_id.setdefault(sid, item)
            sources_by_id[sid].add("fts5")

        ranked_ids = sorted(
            rrf_scores.keys(),
            key=lambda sid: (
                rrf_scores[sid],
                1 if items_by_id[sid].get("isPrimaryType") else 0,
            ),
            reverse=True,
        )[:limit]

        fused: List[Dict[str, Any]] = []
        for sid in ranked_ids:
            entry = dict(items_by_id[sid])
            srcs = sources_by_id[sid]
            entry["source"] = "hybrid" if len(srcs) > 1 else next(iter(srcs))
            entry["score"] = round(rrf_scores[sid], 5)
            fused.append(entry)

        return {
            "query": raw_q,
            "mode": "hybrid-idiom-rrf" if expansion["hasExpansion"] else "fts5-bm25",
            "latencyMs": round((time.perf_counter() - t0) * 1000, 2),
            "expansion": {
                "hasExpansion": expansion["hasExpansion"],
                "matchedIdioms": [
                    {
                        "idiom": m["idiom"],
                        "ecosystem": m["ecosystem"],
                        "category": m["category"],
                        "appleSymbols": m["appleSymbols"],
                        "frameworks": m["frameworks"],
                        "description": m["description"],
                        "snippet": m.get("snippet", ""),
                    }
                    for m in expansion["matchedIdioms"]
                ],
                "mappedSymbols": expansion["mappedSymbols"][:8],
            },
            "count": len(fused),
            "results": fused,
        }

    def format_search_markdown(self, data: Dict[str, Any], semantic: bool = False) -> str:
        q = data.get("query", "")
        results = data.get("results", [])
        lines = [
            f"# Apple Documentation {'Semantic / Idiom' if semantic else 'Symbol'} Search: `{q}`",
            f"**Search Mode:** `{data.get('mode')}` · **Matches:** {len(results)} · **Latency:** `{data.get('latencyMs', 0)} ms`",
            "",
        ]
        exp = data.get("expansion") or {}
        if exp.get("matchedIdioms"):
            for m in exp["matchedIdioms"]:
                syms = ", ".join(f"`{s}`" for s in m["appleSymbols"][:5])
                lines.append(
                    f"> **Cross-Framework Idiom Bridge (`{m['ecosystem']}` -> Apple):** `{m['idiom']}` maps to {syms} — {m['description']}"
                )
            lines.append("")

        if not results:
            lines.append("No matching Apple symbols found. Try a broader keyword or `search_symbols` with `*` wildcards.")
            return "\n".join(lines)

        for idx, r in enumerate(results, 1):
            plats = ", ".join(r.get("platforms", [])[:5])
            plat_str = f" · _{plats}_" if plats else ""
            abs_txt = f"\n   {r['abstract']}" if r.get("abstract") else ""
            lines.append(
                f"{idx}. **{r['title']}** (`{r['framework']}` · {r['kind']} · `{r['source']}`){plat_str}{abs_txt}\n"
                f"   - **Path:** `{r['path']}`\n"
                f"   - **Doc Call:** `get_documentation({{ \"path\": \"{r['path']}\", \"framework\": \"{r['framework']}\" }})`"
            )
        return "\n".join(lines)

    def resolve_symbol(self, path_or_title: str, framework: Optional[str] = None) -> Dict[str, Any]:
        raw = (path_or_title or "").strip()
        if not raw:
            return {"status": "empty"}

        norm_path = raw
        if norm_path.startswith("doc://"):
            idx = norm_path.find("/documentation/")
            if idx != -1:
                norm_path = norm_path[idx:]
        if norm_path.lower().startswith("documentation/"):
            norm_path = "/" + norm_path

        fw_clause = " AND LOWER(framework) = LOWER(?)" if framework else ""
        fw_params = [framework.strip()] if framework else []

        with self._connect() as conn:
            if norm_path.startswith("/"):
                row = conn.execute(
                    f"SELECT * FROM symbols WHERE LOWER(path) = LOWER(?){fw_clause} LIMIT 1",
                    [norm_path.rstrip("/"), *fw_params],
                ).fetchone()
                if row:
                    return {"status": "resolved", "symbol": self._row_to_item(row, source="exact-path")}
            elif "/" in norm_path and not norm_path.startswith("/"):
                cand_path = "/documentation/" + norm_path.strip("/")
                row = conn.execute(
                    f"SELECT * FROM symbols WHERE LOWER(path) = LOWER(?){fw_clause} LIMIT 1",
                    [cand_path, *fw_params],
                ).fetchone()
                if row:
                    return {"status": "resolved", "symbol": self._row_to_item(row, source="relative-path")}

            clean_title = raw.lstrip("@")
            bare_ident = re.sub(r"[^A-Za-z0-9_]", "", clean_title.split("(", 1)[0])
            rows: List[sqlite3.Row] = []
            fw_join_clause = " AND LOWER(s.framework) = LOWER(?)" if framework else ""
            if bare_ident and len(bare_ident) >= 2:
                fts_rows = conn.execute(
                    f"""
                    SELECT s.* FROM symbols_fts
                    JOIN symbols s ON s.rowid = symbols_fts.rowid
                    WHERE symbols_fts MATCH ? {fw_join_clause}
                    LIMIT 40
                    """,
                    [f'"{bare_ident}"', *fw_params],
                ).fetchall()
                ct_low = clean_title.lower()
                bi_low = bare_ident.lower()
                for r in fts_rows:
                    t_low = (r["title"] or "").lower()
                    p_leaf = (r["path"] or "").rsplit("/", 1)[-1].split("(", 1)[0].lower()
                    if (
                        t_low == ct_low
                        or t_low == raw.lower()
                        or t_low.startswith(f"{bi_low}(")
                        or t_low.startswith(f"func {bi_low}(")
                        or t_low.startswith(f"static func {bi_low}(")
                        or t_low.startswith(f"var {bi_low}:")
                        or p_leaf == bi_low
                    ):
                        rows.append(r)
                rows.sort(
                    key=lambda r: (
                        0 if (r["title"] or "").lower() in (ct_low, raw.lower()) else 1,
                        0 if r["is_primary_type"] else 1,
                        len(r["path"] or ""),
                    )
                )

            if len(rows) == 1:
                return {"status": "resolved", "symbol": self._row_to_item(rows[0], source="title")}
            if len(rows) > 1:
                distinct_fws = {r["framework"] for r in rows}
                primaries = [r for r in rows if r["is_primary_type"]]
                if framework or len(distinct_fws) == 1:
                    chosen = primaries[0] if primaries else rows[0]
                    return {"status": "resolved", "symbol": self._row_to_item(chosen, source="title")}
                if len(primaries) == 1:
                    return {"status": "resolved", "symbol": self._row_to_item(primaries[0], source="primary-title")}
                seen_fw: set[str] = set()
                cands = []
                for r in rows:
                    key = f"{r['framework']}::{r['path']}"
                    if key not in seen_fw:
                        seen_fw.add(key)
                        cands.append(self._row_to_item(r, source="candidate"))
                return {"status": "ambiguous", "candidates": cands[:6]}

            fts_fallback = self.search_symbols_data(clean_title, framework=framework, max_results=5)["results"]
            if not fts_fallback:
                sample_titles = [
                    r["title"]
                    for r in conn.execute(
                        "SELECT title FROM symbols WHERE is_primary_type = 1 LIMIT 5000"
                    ).fetchall()
                ]
                close = difflib.get_close_matches(clean_title, sample_titles, n=4, cutoff=0.65)
                for ct in close:
                    r = conn.execute("SELECT * FROM symbols WHERE title = ? LIMIT 1", [ct]).fetchone()
                    if r:
                        fts_fallback.append(self._row_to_item(r, source="fuzzy"))

            return {"status": "not_found", "suggestions": fts_fallback[:5]}

    def _fetch_live_docc_json(self, doc_path: str) -> Optional[Dict[str, Any]]:
        clean = doc_path.strip("/")
        if not clean.startswith("documentation/") and not clean.startswith("tutorials/"):
            clean = f"documentation/{clean}"
        with self._cache_lock:
            if clean in self._docc_cache:
                self._docc_cache.move_to_end(clean)
                return self._docc_cache[clean]

        url = f"{DOCC_CDN_BASE}/{clean}.json"
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "developer.apple.com":
            return None

        req = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "Referer": "https://developer.apple.com/documentation",
                "User-Agent": f"Hermes-AppleDocsPlugin/{PLUGIN_VERSION}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                if resp.status != 200:
                    return None
                raw_bytes = resp.read(2 * 1024 * 1024)
                payload = json.loads(raw_bytes.decode("utf-8", errors="replace"))
        except Exception:
            return None

        if isinstance(payload, dict):
            with self._cache_lock:
                self._docc_cache[clean] = payload
                while len(self._docc_cache) > 128:
                    self._docc_cache.popitem(last=False)
            return payload
        return None

    def get_documentation_data(
        self,
        path: str,
        framework: Optional[str] = None,
        concise: bool = False,
        allow_network: bool = True,
    ) -> Dict[str, Any]:
        t0 = time.perf_counter()
        res = self.resolve_symbol(path, framework=framework)
        status = res.get("status")
        if status == "empty":
            return {"ok": False, "error": 'Error: A non-empty "path" parameter is required.'}
        if status == "ambiguous":
            return {
                "ok": False,
                "ambiguous": True,
                "query": path,
                "candidates": res["candidates"],
            }

        symbol = res.get("symbol")
        target_path = symbol["path"] if symbol else (
            path if path.startswith("/documentation/") else f"/documentation/{framework.lower()}/{path.strip('/')}"
            if framework else f"/documentation/{path.strip('/')}"
        )

        docc = self._fetch_live_docc_json(target_path) if allow_network else None
        if not symbol and not docc:
            return {
                "ok": False,
                "notFound": True,
                "query": path,
                "suggestions": res.get("suggestions", []),
            }

        title = (
            (docc or {}).get("metadata", {}).get("title")
            or (symbol or {}).get("title")
            or path
        )
        fw_name = (
            (symbol or {}).get("framework")
            or framework
            or (
                ((docc or {}).get("metadata", {}).get("modules") or [{}])[0].get("name")
                if isinstance((docc or {}).get("metadata", {}).get("modules"), list)
                and (docc or {}).get("metadata", {}).get("modules")
                else "Apple SDK"
            )
        )
        kind = (
            (docc or {}).get("metadata", {}).get("symbolKind")
            or (symbol or {}).get("kind")
            or "symbol"
        )
        abstract = (
            _format_inline_docc((docc or {}).get("abstract")).strip()
            if docc and docc.get("abstract")
            else (symbol or {}).get("abstract") or ""
        )

        platforms: List[str] = []
        meta_plats = (docc or {}).get("metadata", {}).get("platforms")
        if isinstance(meta_plats, list) and meta_plats:
            for p in meta_plats:
                if isinstance(p, dict) and p.get("name"):
                    ver = p.get("introducedAt")
                    dep = " (deprecated)" if p.get("deprecated") or p.get("deprecatedAt") else ""
                    platforms.append(f"{p['name']} {ver}+{dep}" if ver else f"{p['name']}{dep}")
        if not platforms and symbol:
            platforms = symbol.get("platforms", [])

        declaration = ""
        parameters_md: List[str] = []
        discussion_md = ""
        deprecation_md = ""
        topics: List[Dict[str, Any]] = []

        if docc:
            dep_sum = docc.get("deprecationSummary")
            if dep_sum:
                deprecation_md = _format_docc_blocks(dep_sum, max_paragraphs=2)

            for sec in docc.get("primaryContentSections") or []:
                if not isinstance(sec, dict):
                    continue
                skind = sec.get("kind")
                if skind == "declarations" and not declaration:
                    decls = sec.get("declarations") or []
                    if decls and isinstance(decls[0], dict):
                        tokens = decls[0].get("tokens") or []
                        declaration = "".join(str(t.get("text") or "") for t in tokens if isinstance(t, dict)).strip()
                elif skind == "parameters":
                    for param in (sec.get("parameters") or [])[:12]:
                        if isinstance(param, dict) and param.get("name"):
                            pbody = _format_docc_blocks(param.get("content"), max_paragraphs=2).strip()
                            parameters_md.append(f"- **`{param['name']}`**: {pbody}")
                elif skind == "content" and not concise and not discussion_md:
                    discussion_md = _format_docc_blocks(sec.get("content"), max_paragraphs=6)

            if not concise:
                refs = docc.get("references") or {}
                for tsec in (docc.get("topicSections") or [])[:6]:
                    if not isinstance(tsec, dict):
                        continue
                    titems = []
                    for ident in (tsec.get("identifiers") or [])[:5]:
                        ref = refs.get(ident) if isinstance(refs, dict) else None
                        if isinstance(ref, dict):
                            titems.append({
                                "title": ref.get("title") or ident.rsplit("/", 1)[-1],
                                "url": ref.get("url") or "",
                                "abstract": _format_inline_docc(ref.get("abstract")).strip()[:140],
                            })
                    if titems:
                        topics.append({"title": tsec.get("title") or "Topics", "items": titems})

        return {
            "ok": True,
            "title": title,
            "framework": fw_name,
            "kind": kind,
            "path": target_path,
            "webUrl": f"{DOCC_WEB_BASE}{target_path}",
            "abstract": abstract,
            "platforms": platforms,
            "declaration": declaration,
            "deprecation": deprecation_md,
            "parameters": parameters_md,
            "discussion": discussion_md,
            "topics": topics,
            "source": "offline-db+docc-cdn" if docc else "offline-db",
            "latencyMs": round((time.perf_counter() - t0) * 1000, 2),
        }

    def format_documentation_markdown(
        self,
        path: str,
        framework: Optional[str] = None,
        concise: bool = False,
        allow_network: bool = True,
    ) -> str:
        data = self.get_documentation_data(
            path=path, framework=framework, concise=concise, allow_network=allow_network
        )
        if not data.get("ok"):
            if data.get("ambiguous"):
                lines = [
                    f'UNRESOLVED: Multiple symbols match "{path}". Please disambiguate by passing the exact path or framework:',
                    "",
                ]
                for c in data.get("candidates", []):
                    lines.append(
                        f'• **{c["title"]}** ({c["framework"]} {c["kind"]})\n'
                        f'   Path: `{c["path"]}`\n'
                        f'   Call: `get_documentation({{ "path": "{c["path"]}", "framework": "{c["framework"]}" }})`'
                    )
                return "\n".join(lines)
            if data.get("notFound"):
                lines = [f'Error: Symbol "{path}" was not found in the Apple Documentation index.']
                suggs = data.get("suggestions") or []
                if suggs:
                    lines.append("")
                    lines.append("**Did you mean?**")
                    for s in suggs:
                        lines.append(
                            f'• **{s["title"]}** ({s["framework"]} {s["kind"]}) — `{s["path"]}`\n'
                            f'   Call: `get_documentation({{ "path": "{s["path"]}", "framework": "{s["framework"]}" }})`'
                        )
                return "\n".join(lines)
            return str(data.get("error") or "Error resolving documentation.")

        lines = [
            f"# {data['title']}",
            f"**Framework:** `{data['framework']}` · **Kind:** `{data['kind']}` · **Source:** `{data['source']}`",
        ]
        if data.get("platforms"):
            lines.append(f"**Availability:** {' · '.join(data['platforms'])}")
        lines.append(f"**Apple Docs:** {data['webUrl']}")
        lines.append("")

        if data.get("deprecation"):
            lines.extend(["> [!WARNING]", f"> **Deprecated:** {data['deprecation']}", ""])
        if data.get("abstract"):
            lines.extend([data["abstract"], ""])
        if data.get("declaration"):
            lines.extend(["## Declaration", f"```swift\n{data['declaration']}\n```", ""])
        if data.get("parameters"):
            lines.extend(["## Parameters", *data["parameters"], ""])
        if data.get("discussion") and not concise:
            lines.extend(["## Overview", data["discussion"], ""])
        if data.get("topics") and not concise:
            lines.append("## Topic Reference")
            for sec in data["topics"]:
                lines.append(f"### {sec['title']}")
                for item in sec["items"]:
                    desc = f" — {item['abstract']}" if item.get("abstract") else ""
                    lines.append(f"- **{item['title']}** (`{item['url']}`){desc}")
                lines.append("")

        return "\n".join(lines).strip()

    def diagnose_compiler_output(
        self, command: str = "", output: str = "", returncode: int = 1
    ) -> Dict[str, Any]:
        """Extract deprecated/missing Apple symbols from Swift/Xcode build output and ground them."""
        t0 = time.perf_counter()
        text = output or ""
        if not text.strip():
            return {"matched": False, "findings": [], "annotation": "", "latencyMs": 0.0}

        extracted: List[str] = []
        for pat in _DIAG_PATTERNS:
            for m in pat.finditer(text):
                sym = m.group(1).split("(", 1)[0].split(".", 1)[-1].strip()
                if sym and len(sym) >= 2 and sym not in extracted:
                    extracted.append(sym)

        findings: List[Dict[str, Any]] = []
        for sym in extracted[:5]:
            mig = SWIFT_COMPILER_MIGRATIONS.get(sym)
            if mig:
                resolved = self.resolve_symbol(mig["lookup"], framework=mig.get("framework"))
                db_sym = resolved.get("symbol")
                findings.append({
                    "symbol": sym,
                    "kind": "migration",
                    "replacement": mig["replacement"],
                    "framework": mig["framework"],
                    "reason": mig["reason"],
                    "fixSnippet": mig["fix"],
                    "docPath": db_sym["path"] if db_sym else f"/documentation/{mig['framework'].lower()}",
                })
            else:
                search_res = self.search_symbols_data(sym, max_results=3)["results"]
                if search_res:
                    top = search_res[0]
                    findings.append({
                        "symbol": sym,
                        "kind": "docc-lookup",
                        "replacement": f"{top['title']} ({top['framework']})",
                        "framework": top["framework"],
                        "reason": top["abstract"] or f"Verified {top['kind']} in {top['framework']} ({', '.join(top['platforms'][:4])}).",
                        "fixSnippet": f'get_documentation({{ "path": "{top["path"]}", "framework": "{top["framework"]}" }})',
                        "docPath": top["path"],
                    })

        if not findings:
            return {
                "matched": False,
                "extractedSymbols": extracted,
                "findings": [],
                "annotation": "",
                "latencyMs": round((time.perf_counter() - t0) * 1000, 2),
            }

        ann_lines = [
            "",
            "─── [Apple DocC Grounding · Offline 95.9k Index] ───",
        ]
        for f in findings:
            ann_lines.append(
                f"• `{f['symbol']}` -> **{f['replacement']}** (`{f['framework']}` · `{f['docPath']}`)\n"
                f"  {f['reason']}"
            )
        ann_lines.append("────────────────────────────────────────────────────")

        return {
            "matched": True,
            "command": command,
            "returncode": returncode,
            "extractedSymbols": extracted,
            "findings": findings,
            "annotation": "\n".join(ann_lines),
            "latencyMs": round((time.perf_counter() - t0) * 1000, 2),
        }

    def run_showcase_demo(self) -> Dict[str, Any]:
        """Zero-API-key instant showcase for `/apple-docs demo`, CLI, and Desktop Studio."""
        t0 = time.perf_counter()
        stats = self.get_index_stats()
        wildcard = self.search_symbols_data("Navigation*View", framework="SwiftUI", max_results=4)
        idiom = self.semantic_search_data("React useEffect equivalent", framework="SwiftUI", max_results=4)
        behavior = self.semantic_search_data("prevent sheet swipe dismiss", framework="SwiftUI", max_results=3)
        sample_err = (
            "ContentView.swift:14:9: warning: 'NavigationView' was deprecated in iOS 16.0: "
            "use NavigationStack or NavigationSplitView instead\n"
            "ContentView.swift:22:14: error: value of type 'some View' has no member 'navigationBarItems'\n"
            "ContentView.swift:29:10: warning: 'foregroundColor' was deprecated in iOS 17.0: renamed to 'foregroundStyle'"
        )
        diag = self.diagnose_compiler_output("swift build", sample_err, returncode=1)
        total_ms = round((time.perf_counter() - t0) * 1000, 2)

        top_split = (
            self.resolve_symbol("NavigationSplitView", framework="SwiftUI").get("symbol")
            or (wildcard["results"][0] if wildcard["results"] else None)
        )
        top_dismiss = behavior["results"][0] if behavior["results"] else None

        md_lines = [
            f"##  Apple Docs Ultra — Live Benchmark (`{total_ms} ms`, Zero API Keys)",
            "",
            f"Indexed **{stats['symbolCount']:,} Apple SDK symbols** across **{stats['frameworkCount']} frameworks** (`{stats['mode']}`).",
            "",
            f"### 1. Wildcard FTS5 Globbing (`Navigation*View` — `{wildcard['latencyMs']} ms`)",
        ]
        for r in wildcard["results"][:3]:
            md_lines.append(f"- **{r['title']}** (`{r['framework']}` · {r['kind']}) — `{r['path']}`")

        md_lines.extend([
            "",
            f"### 2. Cross-Framework Idiom RRF (`\"React useEffect equivalent\"` — `{idiom['latencyMs']} ms`)",
        ])
        for r in idiom["results"][:3]:
            md_lines.append(f"- **{r['title']}** (`{r['framework']}` · `{r['source']}`) — {r['abstract'] or r['path']}")

        md_lines.extend([
            "",
            f"### 3. Behavioral Intent Recall (`\"prevent sheet swipe dismiss\"` — `{behavior['latencyMs']} ms`)",
        ])
        for r in behavior["results"][:2]:
            md_lines.append(f"- **{r['title']}** (`{r['framework']}`) — {r['abstract'] or r['path']}")

        md_lines.extend([
            "",
            f"### 4. Automatic `swift build` Compiler Diagnostic Hook (`{diag['latencyMs']} ms`)",
        ])
        for f in diag["findings"]:
            md_lines.append(f"- `{f['symbol']}` $\\rightarrow$ **{f['replacement']}** (`{f['docPath']}`)")

        if top_split:
            plats = ",".join(top_split.get("platforms", [])[:5])
            abs_clean = (top_split.get("abstract") or "Multi-column navigation view for iPadOS, macOS, and visionOS.").replace('"', "'")
            md_lines.extend([
                "",
                f'::apple-doc{{title="{top_split["title"]}" framework="{top_split["framework"]}" kind="{top_split["kind"]}" path="{top_split["path"]}" platforms="{plats}" summary="{abs_clean}"}}',
            ])
        if top_dismiss:
            plats = ",".join(top_dismiss.get("platforms", [])[:5])
            abs_clean = (top_dismiss.get("abstract") or "Conditionally prevents interactive dismissal of popovers and sheets.").replace('"', "'")
            md_lines.extend([
                "",
                f'::apple-doc{{title="{top_dismiss["title"]}" framework="{top_dismiss["framework"]}" kind="{top_dismiss["kind"]}" path="{top_dismiss["path"]}" platforms="{plats}" summary="{abs_clean}"}}',
            ])

        md_lines.extend([
            "",
            "> **Try next:** Open **Apple Docs** in the Hermes Desktop sidebar (`/apple-docs`), reference any API inline with `@apple:NavigationSplitView` or `@apple:useEffect`, or run `/apple-docs idiom SharedPreferences`.",
        ])

        return {
            "totalLatencyMs": total_ms,
            "stats": stats,
            "wildcard": wildcard,
            "idiom": idiom,
            "behavior": behavior,
            "compilerDiagnostics": diag,
            "markdown": "\n".join(md_lines),
        }


_ENGINE: Optional[AppleDocsNativeEngine] = None
_ENGINE_LOCK = threading.Lock()


def get_native_engine() -> AppleDocsNativeEngine:
    global _ENGINE
    with _ENGINE_LOCK:
        if _ENGINE is None:
            _ENGINE = AppleDocsNativeEngine()
        return _ENGINE
