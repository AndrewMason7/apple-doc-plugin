"""FastAPI backend routes for Apple Docs Studio in Hermes Desktop & Dashboard.

Mounted at `/api/plugins/apple-doc-plugin/` by the Hermes dashboard/desktop plugin host.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Body, HTTPException, Query

router = APIRouter()

_ENGINE_MOD: Any = None


def _load_engine_module() -> Any:
    global _ENGINE_MOD
    if _ENGINE_MOD is not None:
        return _ENGINE_MOD
    engine_file = Path(__file__).resolve().parents[1] / "bridges" / "hermes" / "native_engine.py"
    if not engine_file.is_file():
        raise HTTPException(status_code=500, detail=f"native_engine.py missing at {engine_file}")
    spec = importlib.util.spec_from_file_location("apple_docs_native_engine", str(engine_file))
    if spec is None or spec.loader is None:
        raise HTTPException(status_code=500, detail="Could not create module spec for native_engine.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    _ENGINE_MOD = mod
    return mod


def _engine() -> Any:
    return _load_engine_module().get_native_engine()


@router.get("/status")
def get_status() -> Dict[str, Any]:
    return _engine().get_index_stats()


@router.get("/search")
def search_docs(
    q: str = Query("", description="Symbol name, wildcard ('Grid*'), React/Android idiom, or behavioral query"),
    mode: str = Query("semantic", description="semantic | lexical"),
    framework: Optional[str] = Query(None, description="Optional framework filter (e.g. SwiftUI)"),
    platform: Optional[str] = Query(None, description="Optional platform filter (e.g. iOS, visionOS)"),
    symbol_type: Optional[str] = Query(None, description="Optional symbol kind filter"),
    limit: int = Query(20, ge=1, le=60),
) -> Dict[str, Any]:
    eng = _engine()
    if mode == "lexical" or "*" in q or "?" in q:
        return eng.search_symbols_data(
            query=q,
            framework=framework,
            platform=platform,
            symbol_type=symbol_type,
            max_results=limit,
        )
    return eng.semantic_search_data(
        query=q,
        framework=framework,
        platform=platform,
        symbol_type=symbol_type,
        max_results=limit,
    )


@router.get("/doc")
def get_doc(
    path: str = Query(..., description="Symbol title or DocC path"),
    framework: Optional[str] = Query(None, description="Optional framework disambiguator"),
    concise: bool = Query(False),
    live: bool = Query(True, description="Enrich with live developer.apple.com DocC JSON when reachable"),
) -> Dict[str, Any]:
    return _engine().get_documentation_data(
        path=path,
        framework=framework,
        concise=concise,
        allow_network=live,
    )


@router.get("/idioms")
def get_idioms(
    ecosystem: Optional[str] = Query(None, description="react | web | android | general"),
    q: Optional[str] = Query(None, description="Filter idioms"),
) -> Dict[str, Any]:
    mod = _load_engine_module()
    idioms = list(mod.CROSS_FRAMEWORK_IDIOMS)
    if ecosystem and ecosystem.lower() != "all":
        eco = ecosystem.lower()
        idioms = [i for i in idioms if i.get("ecosystem") == eco]
    if q and q.strip():
        needle = q.strip().lower()
        idioms = [
            i
            for i in idioms
            if needle in i["idiom"].lower()
            or needle in i["description"].lower()
            or any(needle in s.lower() for s in i.get("appleSymbols", []))
            or any(needle in a.lower() for a in i.get("aliases", []))
        ]
    return {"count": len(idioms), "idioms": idioms}


@router.post("/diagnose")
def diagnose_build_output(payload: Dict[str, Any] = Body(default={})) -> Dict[str, Any]:
    command = str(payload.get("command") or "swift build")
    output = str(payload.get("output") or "")
    returncode = int(payload.get("returncode") or 1)
    return _engine().diagnose_compiler_output(
        command=command, output=output, returncode=returncode
    )


@router.get("/demo")
def run_demo() -> Dict[str, Any]:
    return _engine().run_showcase_demo()
