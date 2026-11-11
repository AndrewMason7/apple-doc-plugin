"""FastAPI backend routes for Apple Docs Studio in Hermes Desktop & Dashboard.

Mounted at `/api/plugins/apple-doc-plugin/` by the Hermes dashboard/desktop plugin host.
"""

from __future__ import annotations

import importlib.util
import sys
import threading
from pathlib import Path
from typing import Any

try:
    from fastapi import APIRouter, Body, HTTPException, Query
except (ImportError, ModuleNotFoundError):
    class HTTPException(Exception):  # type: ignore[no-redef]
        """Lightweight fallback for fastapi.HTTPException when FastAPI is uninstalled."""

        def __init__(
            self,
            status_code: int = 500,
            detail: Any = None,
            headers: dict[str, str] | None = None,
        ) -> None:
            super().__init__(str(detail) if detail else f"HTTP {status_code}")
            self.status_code = status_code
            self.detail = detail
            self.headers = headers

    def Query(default: Any = ..., **kwargs: Any) -> Any:
        """Lightweight fallback Query marker."""
        return default

    def Body(default: Any = ..., **kwargs: Any) -> Any:
        """Lightweight fallback Body marker."""
        return default

    class APIRouter:  # type: ignore[no-redef]
        """Lightweight fallback router compatible with FastAPI's decorator interface."""

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.routes: list[Any] = []

        def get(self, path: str, *args: Any, **kwargs: Any) -> Any:
            def decorator(fn: Any) -> Any:
                self.routes.append(("GET", path, fn))
                return fn
            return decorator

        def post(self, path: str, *args: Any, **kwargs: Any) -> Any:
            def decorator(fn: Any) -> Any:
                self.routes.append(("POST", path, fn))
                return fn
            return decorator

        def put(self, path: str, *args: Any, **kwargs: Any) -> Any:
            def decorator(fn: Any) -> Any:
                self.routes.append(("PUT", path, fn))
                return fn
            return decorator

        def delete(self, path: str, *args: Any, **kwargs: Any) -> Any:
            def decorator(fn: Any) -> Any:
                self.routes.append(("DELETE", path, fn))
                return fn
            return decorator

        def api_route(self, path: str, methods: list[str] | None = None, *args: Any, **kwargs: Any) -> Any:
            def decorator(fn: Any) -> Any:
                for m in (methods or ["GET"]):
                    self.routes.append((m.upper(), path, fn))
                return fn
            return decorator

        def include_router(self, other: Any, *args: Any, **kwargs: Any) -> None:
            if hasattr(other, "routes"):
                self.routes.extend(other.routes)


router = APIRouter()

_ENGINE_MOD: Any = None
_ENGINE_LOCK = threading.Lock()
_NORMALIZED_IDIOMS_CACHE: list[tuple[dict[str, Any], str, str]] | None = None


def _unwrap_param(val: Any, fallback: Any = None, default: Any = None) -> Any:
    """Extract underlying value if val is a FastAPI Query/Body marker or Ellipsis, else return val."""
    fb = fallback if fallback is not None else default
    if hasattr(val, "default"):
        d = val.default
        return fb if d is ... else d
    return fb if val is ... else val


def _load_engine_module() -> Any:
    global _ENGINE_MOD
    if _ENGINE_MOD is not None:
        return _ENGINE_MOD

    with _ENGINE_LOCK:
        if _ENGINE_MOD is not None:
            return _ENGINE_MOD

        # 1. Check if bridges.hermes.native_engine is already importable directly
        try:
            from bridges.hermes import native_engine as eng_mod
            _ENGINE_MOD = eng_mod
            return eng_mod
        except ImportError:
            pass

        # 2. Resolve relative to dashboard/ directory
        engine_file = Path(__file__).resolve().parents[1] / "bridges" / "hermes" / "native_engine.py"
        if not engine_file.is_file():
            raise HTTPException(status_code=500, detail="native_engine.py missing from plugin bundle")

        spec = importlib.util.spec_from_file_location("apple_docs_native_engine", str(engine_file))
        if spec is None or spec.loader is None:
            raise HTTPException(status_code=500, detail="Could not create module spec for native_engine.py")

        mod = importlib.util.module_from_spec(spec)
        sys.modules["apple_docs_native_engine"] = mod
        spec.loader.exec_module(mod)
        _ENGINE_MOD = mod
        return mod


def _get_normalized_idioms(mod: Any) -> list[tuple[dict[str, Any], str, str]]:
    global _NORMALIZED_IDIOMS_CACHE
    if _NORMALIZED_IDIOMS_CACHE is not None:
        return _NORMALIZED_IDIOMS_CACHE
    raw_idioms = list(getattr(mod, "CROSS_FRAMEWORK_IDIOMS", []))
    cached = []
    for i in raw_idioms:
        eco = str(i.get("ecosystem", "")).lower()
        search_blob = " ".join([
            str(i.get("idiom", "")),
            str(i.get("description", "")),
            str(i.get("category", "")),
            " ".join(str(s) for s in i.get("appleSymbols", [])),
            " ".join(str(a) for a in i.get("aliases", [])),
            " ".join(str(f) for f in i.get("frameworks", [])),
        ]).lower()
        cached.append((i, eco, search_blob))
    _NORMALIZED_IDIOMS_CACHE = cached
    return cached


def _engine() -> Any:
    mod = _load_engine_module()
    if not hasattr(mod, "get_native_engine"):
        raise HTTPException(status_code=500, detail="native_engine module missing get_native_engine()")
    return mod.get_native_engine()


@router.get("/status")
def get_status() -> dict[str, Any]:
    """Return index readiness stats, symbol/framework counts, and engine metadata."""
    try:
        return _engine().get_index_stats()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to fetch index stats.") from exc


@router.get("/search")
def search_docs(
    q: str = Query("", description="Symbol name, wildcard ('Grid*'), React/Android idiom, or behavioral query"),
    mode: str = Query("semantic", description="semantic | lexical"),
    framework: str | None = Query(None, description="Optional framework filter (e.g. SwiftUI)"),
    platform: str | None = Query(None, description="Optional platform filter (e.g. iOS, visionOS)"),
    symbol_type: str | None = Query(None, description="Optional symbol kind filter"),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Execute hybrid Reciprocal Rank Fusion semantic search or lexical FTS5 search."""
    q_val = str(_unwrap_param(q, "") or "").strip()
    mode_val = str(_unwrap_param(mode, "semantic") or "semantic").strip().lower()
    if mode_val not in ("semantic", "lexical"):
        mode_val = "semantic"

    framework_val = _unwrap_param(framework, None)
    if framework_val is not None:
        framework_val = str(framework_val).strip()
        if not framework_val or framework_val.lower() == "all":
            framework_val = None

    platform_val = _unwrap_param(platform, None)
    if platform_val is not None:
        platform_val = str(platform_val).strip()
        if not platform_val or platform_val.lower() == "all":
            platform_val = None

    symbol_type_val = _unwrap_param(symbol_type, None)
    if symbol_type_val is not None:
        symbol_type_val = str(symbol_type_val).strip()
        if not symbol_type_val or symbol_type_val.lower() == "all":
            symbol_type_val = None

    limit_val = _unwrap_param(limit, 20)
    try:
        limit_int = int(limit_val)
    except (ValueError, TypeError):
        limit_int = 20
    limit_int = max(1, min(limit_int, 100))

    try:
        eng = _engine()
        if mode_val == "lexical" or "*" in q_val or "?" in q_val:
            return eng.search_symbols_data(
                query=q_val,
                framework=framework_val,
                platform=platform_val,
                symbol_type=symbol_type_val,
                max_results=limit_int,
            )
        return eng.semantic_search_data(
            query=q_val,
            framework=framework_val,
            platform=platform_val,
            symbol_type=symbol_type_val,
            max_results=limit_int,
        )
    except HTTPException:
        raise
    except Exception as exc:
        err_msg = str(exc).lower()
        if "fts5" in err_msg or "syntax error" in err_msg or "unrecognized token" in err_msg:
            raise HTTPException(status_code=400, detail="Invalid search query syntax.") from exc
        raise HTTPException(status_code=500, detail="Search failed due to an internal database error.") from exc


@router.get("/doc")
def get_doc(
    path: str = Query(..., description="Symbol title or DocC path"),
    framework: str | None = Query(None, description="Optional framework disambiguator"),
    concise: bool = Query(False),
    live: bool = Query(True, description="Enrich with live developer.apple.com DocC JSON when reachable"),
) -> dict[str, Any]:
    """Retrieve grounded documentation for an exact Apple symbol or DocC path."""
    path_val = str(_unwrap_param(path, "") or "").strip()
    if not path_val:
        raise HTTPException(status_code=400, detail="A non-empty 'path' parameter is required.")

    framework_val = _unwrap_param(framework, None)
    if framework_val is not None:
        framework_val = str(framework_val).strip()
        if not framework_val or framework_val.lower() == "all":
            framework_val = None

    concise_val = _unwrap_param(concise, False)
    if isinstance(concise_val, str):
        concise_val = concise_val.lower() in ("true", "1", "yes")
    else:
        concise_val = bool(concise_val)

    live_val = _unwrap_param(live, True)
    if isinstance(live_val, str):
        live_val = live_val.lower() in ("true", "1", "yes")
    else:
        live_val = bool(live_val)

    try:
        return _engine().get_documentation_data(
            path=path_val,
            framework=framework_val,
            concise=concise_val,
            allow_network=live_val,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch documentation for '{path_val}'.") from exc


@router.get("/idioms")
def get_idioms(
    ecosystem: str | None = Query(None, description="react | web | android | general"),
    q: str | None = Query(None, description="Filter idioms"),
) -> dict[str, Any]:
    """Retrieve cross-framework translation patterns (React, Android, Web CSS -> SwiftUI)."""
    eco_val = _unwrap_param(ecosystem, None)
    if eco_val is not None:
        eco_val = str(eco_val).strip().lower()
        if eco_val == "all" or not eco_val:
            eco_val = None

    q_val = _unwrap_param(q, None)
    needle = str(q_val).strip().lower() if q_val is not None else ""

    try:
        mod = _load_engine_module()
        cached = _get_normalized_idioms(mod)
        matched = []
        for item, eco, blob in cached:
            if eco_val and eco != eco_val:
                continue
            if needle and needle not in blob:
                continue
            matched.append(item)
        return {"count": len(matched), "idioms": matched}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to fetch idioms.") from exc


@router.post("/diagnose")
def diagnose_build_output(payload: dict[str, Any] = Body(default={})) -> dict[str, Any]:  # noqa: B008
    """Extract deprecated/missing Apple symbols from Swift/Xcode build output and ground them."""
    raw_payload = _unwrap_param(payload, default={})
    if not isinstance(raw_payload, dict):
        raw_payload = {}

    command = str(raw_payload.get("command") or "swift build")
    output = str(raw_payload.get("output") or "")
    rc_val = raw_payload.get("returncode")
    try:
        returncode = int(rc_val) if rc_val is not None else 1
    except (ValueError, TypeError):
        returncode = 1

    try:
        return _engine().diagnose_compiler_output(
            command=command, output=output, returncode=returncode
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Diagnosis failed.") from exc


@router.get("/demo")
def run_demo() -> dict[str, Any]:
    """Run full showcase benchmark across stats, search, idioms, and compiler diagnostics."""
    try:
        return _engine().run_showcase_demo()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Showcase demo failed.") from exc


__all__ = [
    "HTTPException",
    "diagnose_build_output",
    "get_doc",
    "get_idioms",
    "get_status",
    "router",
    "run_demo",
    "search_docs",
]
