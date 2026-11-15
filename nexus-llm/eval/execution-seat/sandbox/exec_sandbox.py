#!/usr/bin/env python3
"""Execution-seat sandbox runner (DRAFT; wires nothing, dispatches nothing).

One Dispatch = one fresh, ephemeral sandbox that lives for a whole model session. Each command runs in new
net/mount/pid/ipc/uts namespaces (no network, every mount read-only except the dispatch workdir), as an
unprivileged uid, under CPU/memory/process/file/size limits and a hard wall clock. Everything the command prints
or writes is captured as the artifact; truncation is always marked, never silent.

Needs root (or CAP_SYS_ADMIN) for mount/unshare, as on a GitHub Actions runner with sudo. See DESIGN-DRAFT.md.
"""
import hashlib
import json
import os
import shutil
import signal
import subprocess
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
INIT = os.path.join(HERE, "sandbox_init.sh")

DEFAULT_CAPS = {
    "wall_s": 10,            # hard wall clock per command (SIGKILL)
    "cpu_s": 8,              # RLIMIT_CPU
    "as_bytes": 512 * 2**20, # RLIMIT_AS
    "nproc": 64,             # RLIMIT_NPROC (counted per uid, so the uid must be unprivileged)
    "nofile": 128,
    "fsize": 8 * 2**20,      # RLIMIT_FSIZE per file
    "work_bytes": 16 * 2**20,  # workdir tmpfs size
    "out_bytes": 256 * 1024,   # captured stdout / stderr cap, each
}


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def tree_hash(root):
    """SHA-256 over (relative path, file hash) of every regular file under root; None if root does not exist."""
    if not os.path.isdir(root):
        return None
    h = hashlib.sha256()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            p = os.path.join(dirpath, name)
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            with open(p, "rb") as f:
                h.update(os.path.relpath(p, root).encode() + b"\0" + hashlib.sha256(f.read()).digest())
    return h.hexdigest()


def _read_capped(stream, cap, sink, state):
    total = 0
    while True:
        chunk = stream.read(4096)
        if not chunk:
            break
        total += len(chunk)
        if len(sink) < cap:
            sink.extend(chunk[: cap - len(sink)])
        if total > cap:
            state["over"] = True
            return total
    return total


class Dispatch:
    """An ephemeral dispatch: a size-capped tmpfs workdir plus an ordered command log."""

    def __init__(self, caps=None, init_script=None, unshare_flags=None):
        self.caps = {**DEFAULT_CAPS, **(caps or {})}
        self.init = init_script or INIT
        self.flags = unshare_flags if unshare_flags is not None else ["--net", "--mount", "--pid", "--fork", "--mount-proc", "--ipc", "--uts", "--kill-child"]
        self.host_work = tempfile.mkdtemp(prefix="sbx-work-")
        subprocess.run(["mount", "-t", "tmpfs", "-o", f"size={self.caps['work_bytes']},mode=1777", "tmpfs", self.host_work], check=True)
        os.chmod(self.host_work, 0o777)
        self.commands = []
        self.closed = False

    def put(self, name, data):
        """Place a file in the workdir before the model runs (task inputs)."""
        p = os.path.join(self.host_work, name)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            f.write(data if isinstance(data, bytes) else data.encode())
        os.chmod(p, 0o666)

    def run(self, argv):
        assert not self.closed
        c = self.caps
        env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/srv", "SBX_WORK": "/srv", "SBX_HOST_WORK": self.host_work,
               "SBX_WORK_BYTES": str(c["work_bytes"]), "SBX_CPU_S": str(c["cpu_s"]), "SBX_AS_BYTES": str(c["as_bytes"]),
               "SBX_NPROC": str(c["nproc"]), "SBX_NOFILE": str(c["nofile"]), "SBX_FSIZE": str(c["fsize"]), "SBX_WALL_S": str(c["wall_s"])}
        cmd = ["unshare", *self.flags, self.init, *argv]
        out, err, state = bytearray(), bytearray(), {"over": False}
        t0 = time.monotonic()
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, env=env, start_new_session=True)
        counts = {}
        th = [threading.Thread(target=lambda s, sink, k: counts.__setitem__(k, _read_capped(s, c["out_bytes"], sink, state)), args=(p.stdout, out, "out")),
              threading.Thread(target=lambda s, sink, k: counts.__setitem__(k, _read_capped(s, c["out_bytes"], sink, state)), args=(p.stderr, err, "err"))]
        for t in th:
            t.start()
        deadline = t0 + c["wall_s"] + 5  # the in-sandbox timeout fires first; this is the backstop
        while p.poll() is None and not state["over"] and time.monotonic() < deadline:
            time.sleep(0.02)
        reason = None
        if state["over"] and p.poll() is None:
            reason = "output-cap"
        elif p.poll() is None:
            reason = "timeout"
        if reason:
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        p.wait()
        for t in th:
            t.join()
        elapsed = time.monotonic() - t0
        code = p.returncode
        if reason is None:
            if code in (124, 137, -9) and elapsed >= c["wall_s"] * 0.95:
                reason = "timeout"
            elif code in (152, -24):
                reason = "cpu-limit"
            elif code == 97:
                reason = "sandbox-setup-failed"
            else:
                reason = "exit"
        rec = {"argv": argv, "exit_code": code, "termination": reason, "elapsed_s": round(elapsed, 3),
               "stdout_bytes": counts.get("out", 0), "stderr_bytes": counts.get("err", 0),
               "stdout_truncated": counts.get("out", 0) > c["out_bytes"], "stderr_truncated": counts.get("err", 0) > c["out_bytes"],
               "stdout_sha256": sha256_bytes(bytes(out)), "stderr_sha256": sha256_bytes(bytes(err)),
               "work_sha256_after": tree_hash(self.host_work)}  # lets a check tell whether a verification ran after the last edit
        self.commands.append({"rec": rec, "stdout": bytes(out), "stderr": bytes(err)})
        return rec, bytes(out), bytes(err)

    def finish(self, out_dir):
        """Write the artifact and destroy the workdir. Returns the manifest."""
        assert not self.closed
        os.makedirs(os.path.join(out_dir, "stdout"), exist_ok=True)
        os.makedirs(os.path.join(out_dir, "stderr"), exist_ok=True)
        lines, files = [], {}
        for i, c in enumerate(self.commands):
            c["rec"]["id"] = i
            lines.append(json.dumps(c["rec"], sort_keys=True))
            for kind in ("stdout", "stderr"):
                with open(os.path.join(out_dir, kind, f"{i}.txt"), "wb") as f:
                    f.write(c[kind])
        with open(os.path.join(out_dir, "commands.jsonl"), "w") as f:
            f.write("\n".join(lines) + ("\n" if lines else ""))
        diff = []
        for dirpath, _, filenames in os.walk(self.host_work):
            for name in sorted(filenames):
                p = os.path.join(dirpath, name)
                if os.path.isfile(p) and not os.path.islink(p):
                    with open(p, "rb") as f:
                        data = f.read()
                    diff.append({"path": os.path.relpath(p, self.host_work), "sha256": sha256_bytes(data), "size": len(data)})
        diff.sort(key=lambda d: d["path"])
        with open(os.path.join(out_dir, "fs-diff.json"), "w") as f:
            json.dump(diff, f, sort_keys=True, indent=1)
        for dirpath, _, filenames in os.walk(out_dir):
            for name in filenames:
                p = os.path.join(dirpath, name)
                with open(p, "rb") as f:
                    files[os.path.relpath(p, out_dir)] = sha256_bytes(f.read())
        manifest = {"caps": self.caps, "commands": len(self.commands), "init_sha256": sha256_bytes(open(self.init, "rb").read()), "files": dict(sorted(files.items()))}
        with open(os.path.join(out_dir, "manifest.json"), "w") as f:
            json.dump(manifest, f, sort_keys=True, indent=1)
        subprocess.run(["umount", self.host_work], check=True)
        shutil.rmtree(self.host_work, ignore_errors=True)
        self.closed = True
        return manifest
