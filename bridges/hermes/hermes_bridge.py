"""
Hermes Agent to Node.js MCP Bridge for Apple Developer Documentation.

Maintains an optional warm Node.js child process running bin/launcher.cjs,
communicating over stdio using JSON-RPC 2.0 (Model Context Protocol) when
768-dimensional vector embeddings and Node.js >= 22 are available.
Honours Hermes profile credential isolation via agent.secret_scope.get_secret.
"""

from __future__ import annotations

import atexit
import collections
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Deque, Dict, Optional

_PASSTHROUGH_ENV_KEYS = (
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "XDG_CACHE_HOME",
    "NODE_EXTRA_CA_CERTS",
    "APPLE_DOCS_DB_PATH",
    "APPLE_DOCS_EMBEDDING_PROVIDER",
    "APPLE_DOCS_SKIP_AUTO_IMPORT",
)


def _build_isolated_child_env() -> Dict[str, str]:
    """Construct a minimal child environment without copying cross-profile secrets."""
    env: Dict[str, str] = {}
    for key in _PASSTHROUGH_ENV_KEYS:
        val = os.environ.get(key)
        if val:
            env[key] = val

    # Catalog Rule 11: resolve optional API credentials strictly through Hermes secret_scope
    # Known limitation: NodeMcpBridge is a process-global singleton, so the key is
    # sampled once per child spawn, not per calling profile. Under a multiplexed
    # gateway the first profile to spawn the child wins until it is closed.
    try:
        from agent.secret_scope import get_secret

        gemini_key = get_secret("GEMINI_API_KEY")
        if gemini_key:
            env["GEMINI_API_KEY"] = gemini_key
    except Exception as exc:
        # secret_scope is context-local and deliberately fails closed when no
        # profile scope is active (e.g. an unscoped gateway thread). The child
        # then runs keylessly — offline engines are unaffected — but surface it
        # instead of swallowing, so a misconfigured profile is visible.
        sys.stderr.write(
            f"[apple-doc-plugin] GEMINI_API_KEY not resolved via secret_scope: {exc}\n"
        )

    # Review fix: never inherit ambient Google Application Default Credentials
    # (GOOGLE_APPLICATION_CREDENTIALS / gcloud credential file / metadata
    # server) — those belong to whatever other tool the user logged in with,
    # not to this plugin. Under the bridge, the only accepted embedding
    # credential is the secret_scope GEMINI_API_KEY above.
    env["APPLE_DOCS_DISABLE_ADC"] = "1"

    return env


class NodeMcpBridge:
    def __init__(self, launcher_path: Optional[Path] = None):
        self.bridge_dir = Path(__file__).resolve().parent
        self.root_dir = self.bridge_dir.parent.parent
        self.launcher_path = launcher_path or (self.root_dir / "bin" / "launcher.cjs")
        self.process: Optional[subprocess.Popen] = None
        self._init_lock = threading.Lock()
        self._lock = threading.RLock()
        self._req_id = 0
        self._pending_requests: Dict[int, threading.Event] = {}
        self._responses: Dict[int, Dict[str, Any]] = {}
        self._stdout_thread: Optional[threading.Thread] = None
        self._stderr_thread: Optional[threading.Thread] = None
        self._stderr_buffer: Deque[str] = collections.deque(maxlen=200)
        self._is_closing = False
        self._initialized = False

        atexit.register(self.close)

    def _check_node_version(self, node_bin: str) -> None:
        try:
            res = subprocess.run(
                [node_bin, "-v"],
                capture_output=True,
                encoding="utf-8",
                errors="replace",
                timeout=10,
                check=True,
            )
            match = re.search(r"v(\d+)", res.stdout.strip())
            if match:
                major = int(match.group(1))
                if major < 22:
                    raise RuntimeError(
                        f"Node.js >= 22 is required (detected v{major}). Please upgrade your Node.js runtime."
                    )
        except Exception as err:
            if isinstance(err, RuntimeError):
                raise

    def _ensure_process(self) -> None:
        with self._init_lock:
            if self.process is not None and self.process.poll() is None and self._initialized:
                return

            self._is_closing = False
            self._initialized = False

            node_bin = shutil.which("node")
            if not node_bin:
                raise RuntimeError(
                    "Node.js >= 22 is required to run the Node vector bridge. "
                    "The built-in Python SQLite FTS5 engine handles offline lookups automatically."
                )

            self._check_node_version(node_bin)

            if not self.launcher_path.exists():
                raise FileNotFoundError(f"Launcher script not found at {self.launcher_path}")

            env = _build_isolated_child_env()
            with self._lock:
                self._stderr_buffer.clear()
                self._pending_requests.clear()
                self._responses.clear()

            self.process = subprocess.Popen(
                [node_bin, str(self.launcher_path)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                cwd=str(self.root_dir),
                env=env,
            )

            self._stdout_thread = threading.Thread(target=self._stdout_reader_loop, daemon=True)
            self._stdout_thread.start()

            self._stderr_thread = threading.Thread(target=self._stderr_reader_loop, daemon=True)
            self._stderr_thread.start()

            self._initialize_handshake()
            self._initialized = True

    def _stdout_reader_loop(self) -> None:
        proc = self.process
        if not proc or not proc.stdout:
            return

        try:
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                except json.JSONDecodeError:
                    continue

                msg_id = msg.get("id")
                if msg_id is not None:
                    with self._lock:
                        event = self._pending_requests.pop(msg_id, None)
                        if event:
                            self._responses[msg_id] = msg
                            event.set()
        finally:
            exit_code = proc.poll() if proc else None
            err_msg = f"Node MCP process terminated unexpectedly (exit code: {exit_code})"
            if self._stderr_buffer:
                err_msg += ". Recent stderr:\n" + "\n".join(list(self._stderr_buffer)[-5:])

            err_resp = {"error": {"code": -32000, "message": err_msg}}
            with self._lock:
                for req_id, event in list(self._pending_requests.items()):
                    self._responses[req_id] = err_resp
                    event.set()
                self._pending_requests.clear()

    def _stderr_reader_loop(self) -> None:
        proc = self.process
        if not proc or not proc.stderr:
            return

        try:
            for line in proc.stderr:
                line = line.rstrip()
                if line:
                    self._stderr_buffer.append(line)
        except Exception:
            pass

    def _initialize_handshake(self) -> None:
        req_id = self._next_id()
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "hermes-agent", "version": "1.1.0"},
            },
        }

        event = threading.Event()
        with self._lock:
            self._pending_requests[req_id] = event

        self._send_raw(payload)

        if not event.wait(timeout=60.0):
            with self._lock:
                self._pending_requests.pop(req_id, None)
            err_diagnostics = "\n".join(list(self._stderr_buffer)[-10:])
            raise TimeoutError(
                f"Timed out initializing Apple Doc MCP server. Recent stderr:\n{err_diagnostics}"
            )

        with self._lock:
            self._responses.pop(req_id, None)

        self._send_raw(
            {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
        )

    def _next_id(self) -> int:
        with self._lock:
            self._req_id += 1
            return self._req_id

    def _send_raw(self, payload: Dict[str, Any]) -> None:
        with self._lock:
            if not self.process or not self.process.stdin or self.process.poll() is not None:
                raise RuntimeError("Node MCP process is not running or stdin is closed.")
            try:
                encoded = json.dumps(payload) + "\n"
                self.process.stdin.write(encoded)
                self.process.stdin.flush()
            except (BrokenPipeError, OSError) as err:
                raise RuntimeError(f"Failed to communicate with Node MCP process: {err}")

    def call_tool(
        self, name: str, arguments: Optional[Dict[str, Any]] = None, timeout: float = 30.0
    ) -> str:
        self._ensure_process()
        req_id = self._next_id()
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments or {},
            },
        }

        event = threading.Event()
        with self._lock:
            self._pending_requests[req_id] = event

        try:
            self._send_raw(payload)
        except Exception:
            with self._lock:
                self._pending_requests.pop(req_id, None)
            raise

        if not event.wait(timeout=timeout):
            with self._lock:
                self._pending_requests.pop(req_id, None)
            raise TimeoutError(f"Call to tool '{name}' timed out after {timeout}s.")

        with self._lock:
            resp = self._responses.pop(req_id, {})

        if "error" in resp:
            err = resp["error"]
            return f"Error ({err.get('code', 'UNKNOWN')}): {err.get('message', 'Unknown tool error')}"

        result = resp.get("result", {})
        if "content" in result and isinstance(result["content"], list):
            texts = [
                item["text"]
                for item in result["content"]
                if isinstance(item, dict) and item.get("type") == "text" and "text" in item
            ]
            if texts:
                return "\n".join(texts)

        return json.dumps(result, indent=2)

    def close(self) -> None:
        with self._lock:
            if self._is_closing:
                return
            self._is_closing = True
            self._initialized = False

            for req_id, event in list(self._pending_requests.items()):
                self._responses[req_id] = {"error": {"code": -32000, "message": "Bridge closed"}}
                event.set()
            self._pending_requests.clear()

            if self.process:
                for pipe in (self.process.stdin, self.process.stdout, self.process.stderr):
                    if pipe:
                        try:
                            pipe.close()
                        except Exception:
                            pass
                try:
                    self.process.terminate()
                    self.process.wait(timeout=2.0)
                except Exception:
                    try:
                        self.process.kill()
                        self.process.wait(timeout=1.0)
                    except Exception:
                        pass
                self.process = None


_GLOBAL_BRIDGE: Optional[NodeMcpBridge] = None
_GLOBAL_LOCK = threading.RLock()


def get_bridge() -> NodeMcpBridge:
    global _GLOBAL_BRIDGE
    with _GLOBAL_LOCK:
        if _GLOBAL_BRIDGE is None:
            _GLOBAL_BRIDGE = NodeMcpBridge()
        return _GLOBAL_BRIDGE
