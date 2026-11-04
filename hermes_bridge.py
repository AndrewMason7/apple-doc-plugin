"""
Hermes Agent to Node.js MCP Bridge for Apple Developer Documentation.

Maintains a persistent, warm Node.js child process running bin/launcher.cjs,
communicating over stdio using JSON-RPC 2.0 (Model Context Protocol).
"""

import atexit
import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Dict, Optional


class NodeMcpBridge:
    def __init__(self, launcher_path: Optional[Path] = None):
        self.root_dir = Path(__file__).resolve().parent
        self.launcher_path = launcher_path or (self.root_dir / "bin" / "launcher.cjs")
        self.process: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._req_id = 0
        self._pending_requests: Dict[int, threading.Event] = {}
        self._responses: Dict[int, Dict[str, Any]] = {}
        self._reader_thread: Optional[threading.Thread] = None
        self._is_closing = False
        self._initialized = False

        atexit.register(self.close)

    def _ensure_process(self) -> None:
        with self._lock:
            if self.process is not None and self.process.poll() is None:
                return

            node_bin = shutil.which("node")
            if not node_bin:
                raise RuntimeError(
                    "Node.js >= 22 is required to run the Apple Developer Documentation engine. "
                    "Please install Node.js via your package manager (e.g. `brew install node`)."
                )

            if not self.launcher_path.exists():
                raise FileNotFoundError(f"Launcher script not found at {self.launcher_path}")

            env = os.environ.copy()
            # Ensure cwd is repo root
            self.process = subprocess.Popen(
                [node_bin, str(self.launcher_path)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=str(self.root_dir),
                env=env,
            )

            self._reader_thread = threading.Thread(
                target=self._stdout_reader_loop, daemon=True
            )
            self._reader_thread.start()

            # Handshake
            self._initialize_handshake()

    def _stdout_reader_loop(self) -> None:
        if not self.process or not self.process.stdout:
            return

        for line in self.process.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue

            msg_id = msg.get("id")
            if msg_id is not None and msg_id in self._pending_requests:
                self._responses[msg_id] = msg
                event = self._pending_requests[msg_id]
                event.set()

    def _initialize_handshake(self) -> None:
        req_id = self._next_id()
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "hermes-agent", "version": "1.0.0"},
            },
        }

        event = threading.Event()
        self._pending_requests[req_id] = event

        self._send_raw(payload)

        if not event.wait(timeout=15.0):
            err_msg = ""
            if self.process and self.process.stderr:
                try:
                    err_msg = self.process.stderr.read()
                except Exception:
                    pass
            raise TimeoutError(
                f"Timed out initializing Apple Doc MCP server. Details: {err_msg}"
            )

        del self._pending_requests[req_id]
        self._responses.pop(req_id, None)

        # Send notifications/initialized
        self._send_raw(
            {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}}
        )
        self._initialized = True

    def _next_id(self) -> int:
        self._req_id += 1
        return self._req_id

    def _send_raw(self, payload: Dict[str, Any]) -> None:
        if not self.process or not self.process.stdin:
            raise RuntimeError("Process stdin is not open.")
        encoded = json.dumps(payload) + "\n"
        self.process.stdin.write(encoded)
        self.process.stdin.flush()

    def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None, timeout: float = 30.0) -> str:
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
        self._pending_requests[req_id] = event

        with self._lock:
            self._send_raw(payload)

        if not event.wait(timeout=timeout):
            self._pending_requests.pop(req_id, None)
            raise TimeoutError(f"Call to tool '{name}' timed out after {timeout}s.")

        resp = self._responses.pop(req_id, {})
        self._pending_requests.pop(req_id, None)

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

            if self.process:
                try:
                    self.process.terminate()
                    self.process.wait(timeout=2.0)
                except Exception:
                    try:
                        self.process.kill()
                    except Exception:
                        pass
                self.process = None


_GLOBAL_BRIDGE: Optional[NodeMcpBridge] = None
_GLOBAL_LOCK = threading.Lock()


def get_bridge() -> NodeMcpBridge:
    global _GLOBAL_BRIDGE
    with _GLOBAL_LOCK:
        if _GLOBAL_BRIDGE is None:
            _GLOBAL_BRIDGE = NodeMcpBridge()
        return _GLOBAL_BRIDGE
