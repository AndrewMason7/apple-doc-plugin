"""
Hermes Agent to Node.js MCP Bridge for Apple Developer Documentation.

Maintains a persistent, warm Node.js child process running bin/launcher.cjs,
communicating over stdio using JSON-RPC 2.0 (Model Context Protocol).
Thread-safe, deadlock-free with asynchronous stderr draining and fail-fast crash detection.
"""

import atexit
import collections
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Deque, Dict, Optional


class NodeMcpBridge:
    def __init__(self, launcher_path: Optional[Path] = None):
        self.root_dir = Path(__file__).resolve().parent
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

        # Clean termination hooks
        atexit.register(self.close)
        self._install_signal_handlers()

    def _install_signal_handlers(self) -> None:
        try:
            prev_term = signal.getsignal(signal.SIGTERM)
            def handle_sigterm(signum, frame):
                self.close()
                if callable(prev_term) and prev_term not in (signal.SIG_IGN, signal.SIG_DFL):
                    prev_term(signum, frame)
                sys.exit(143)
            signal.signal(signal.SIGTERM, handle_sigterm)
        except (ValueError, AttributeError):
            pass

    def _check_node_version(self, node_bin: str) -> None:
        try:
            res = subprocess.run([node_bin, "-v"], capture_output=True, text=True, check=True)
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
                    "Node.js >= 22 is required to run the Apple Developer Documentation engine. "
                    "Please install Node.js via your package manager (e.g. `brew install node`)."
                )

            self._check_node_version(node_bin)

            if not self.launcher_path.exists():
                raise FileNotFoundError(f"Launcher script not found at {self.launcher_path}")

            env = os.environ.copy()
            with self._lock:
                self._stderr_buffer.clear()
                self._pending_requests.clear()
                self._responses.clear()

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

            # Continuous non-blocking stdout reader
            self._stdout_thread = threading.Thread(
                target=self._stdout_reader_loop, daemon=True
            )
            self._stdout_thread.start()

            # Continuous non-blocking stderr reader to prevent OS pipe buffer deadlocks
            self._stderr_thread = threading.Thread(
                target=self._stderr_reader_loop, daemon=True
            )
            self._stderr_thread.start()

            # Initialize MCP handshake
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
            # Subprocess terminated or stdout closed: notify all pending waiters immediately
            exit_code = proc.poll() if proc else None
            err_msg = f"Node MCP process terminated unexpectedly (exit code: {exit_code})"
            if self._stderr_buffer:
                err_msg += f". Recent stderr:\n" + "\n".join(list(self._stderr_buffer)[-5:])

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
                "clientInfo": {"name": "hermes-agent", "version": "1.0.0"},
            },
        }

        event = threading.Event()
        with self._lock:
            self._pending_requests[req_id] = event

        self._send_raw(payload)

        if not event.wait(timeout=15.0):
            with self._lock:
                self._pending_requests.pop(req_id, None)
            err_diagnostics = "\n".join(list(self._stderr_buffer)[-10:])
            raise TimeoutError(
                f"Timed out initializing Apple Doc MCP server. Recent stderr:\n{err_diagnostics}"
            )

        with self._lock:
            self._responses.pop(req_id, None)

        # Send notifications/initialized
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

            # Wake up all pending callers
            for req_id, event in list(self._pending_requests.items()):
                self._responses[req_id] = {"error": {"code": -32000, "message": "Bridge closed"}}
                event.set()
            self._pending_requests.clear()

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
_GLOBAL_LOCK = threading.RLock()


def get_bridge() -> NodeMcpBridge:
    global _GLOBAL_BRIDGE
    with _GLOBAL_LOCK:
        if _GLOBAL_BRIDGE is None:
            _GLOBAL_BRIDGE = NodeMcpBridge()
        return _GLOBAL_BRIDGE
