#!/usr/bin/env python3
"""Acceptance probes EX-S1..S7 for the execution sandbox (DRAFT). Run as root:  python3 probes.py

Each probe runs against the REAL sandbox (must pass) and against a deliberately BROKEN variant (must fail), so a probe
that cannot fail is caught. Anything a broken variant writes to the host is removed and the restoration is proven by hash.
Prints one JSON report. Exit code 0 only if every real probe passes and every broken variant fails its probe.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import exec_sandbox as sbx

PY = "python3"
BASE_PROBE_DIR = "/opt/sbx-probe-base"   # throwaway stand-in for "the base": created, hashed, and restored by the probe
PERSIST_DIR = "/opt/sbx-probe-persist"


def with_dispatch(fn, **kw):
    d = sbx.Dispatch(**kw)
    try:
        return fn(d)
    finally:
        out = tempfile.mkdtemp(prefix="sbx-art-")
        d.finish(out)
        shutil.rmtree(out, ignore_errors=True)


def variant_init(sub_from, sub_to):
    src = open(sbx.INIT).read()
    assert sub_from in src, sub_from
    path = os.path.join(tempfile.mkdtemp(prefix="sbx-broken-"), "init.sh")
    open(path, "w").write(src.replace(sub_from, sub_to))
    os.chmod(path, 0o755)
    return path


def s1_network(d):
    code = ("import socket,sys\n"
            "ifs=[l.split(':')[0].strip() for l in open('/proc/net/dev').read().split('\\n')[2:] if ':' in l]\n"
            "s=socket.socket(); s.settimeout(2)\n"
            "try: s.connect(('93.184.216.34',80)); conn='connected'\n"
            "except OSError as e: conn='errno%s'%e.errno\n"
            "print(','.join(ifs), conn)\n")
    rec, out, _ = d.run([PY, "-c", code])
    ifs, conn = out.decode().strip().split(" ")
    return {"ok": ifs == "lo" and conn.startswith("errno"), "interfaces": ifs, "connect": conn}


def s2_readonly_base(d):
    before = sbx.tree_hash(BASE_PROBE_DIR)
    code = ("import os\nres=[]\n"
            f"for p in ('{BASE_PROBE_DIR}/new.txt','/etc/sbx-probe','/usr/sbx-probe'):\n"
            "  try: open(p,'w').write('x'); res.append('wrote')\n"
            "  except OSError as e: res.append('errno%s'%e.errno)\n"
            "print(' '.join(res))\n")
    rec, out, _ = d.run([PY, "-c", code])
    return {"ok": out.decode().strip() == "errno30 errno30 errno30", "results": out.decode().strip(), "tree_hash_before": before}


def s3_process_cap(d):
    code = ("import os,time\nkids=[]\n"
            "for i in range(300):\n"
            "  try:\n"
            "    pid=os.fork()\n"
            "    if pid==0: time.sleep(3); os._exit(0)\n"
            "    kids.append(pid)\n"
            "  except OSError: break\n"
            "print(len(kids))\n"
            "for k in kids: os.kill(k,9)\n")
    rec, out, _ = d.run([PY, "-c", code])
    n = int(out.decode().strip() or 0)
    return {"ok": 0 < n <= d.caps["nproc"] and n < 300, "forked": n, "cap": d.caps["nproc"], "termination": rec["termination"]}


def s4_memory_cap(d):
    code = "try:\n  b=bytearray(1024*2**20); print('allocated')\nexcept MemoryError: print('MemoryError')\n"
    rec, out, _ = d.run([PY, "-c", code])
    return {"ok": out.decode().strip() == "MemoryError", "result": out.decode().strip()}


def s5_wall_clock(d):
    rec, _, _ = d.run(["sleep", "8"])
    return {"ok": rec["termination"] == "timeout" and rec["elapsed_s"] < 5, "termination": rec["termination"], "elapsed_s": rec["elapsed_s"]}


def s6_output_cap(d):
    rec, out, _ = d.run(["head", "-c", "1000000", "/dev/zero"])
    return {"ok": rec["stdout_truncated"] and rec["stdout_bytes"] > d.caps["out_bytes"] and len(out) <= d.caps["out_bytes"],
            "stdout_truncated": rec["stdout_truncated"], "true_bytes_counted": rec["stdout_bytes"], "kept": len(out), "termination": rec["termination"]}


def s7_ephemeral(_unused=None, **kw):
    def a(d):
        rec, _, _ = d.run(["sh", "-c", "echo secret > /srv/from_a.txt"])
        return {"wrote": rec["exit_code"] == 0}
    first = with_dispatch(a, **kw)
    def b(d):
        rec, out, _ = d.run(["sh", "-c", "ls /srv; ls /opt/sbx-probe-persist 2>&1 | head -3"])
        return {"seen": out.decode().strip()}
    second = with_dispatch(b, **kw)
    return {"ok": first["wrote"] and "from_a.txt" not in second["seen"], "first_wrote": first["wrote"], "second_sees": second["seen"]}


def setup_dirs():
    os.makedirs(BASE_PROBE_DIR, exist_ok=True)
    os.chmod(BASE_PROBE_DIR, 0o777)  # world-writable on purpose: only the read-only mount may stop the unprivileged uid
    open(os.path.join(BASE_PROBE_DIR, "keep.txt"), "w").write("base\n")
    os.makedirs(PERSIST_DIR, exist_ok=True)
    os.chmod(PERSIST_DIR, 0o777)
    shutil.rmtree(PERSIST_DIR + "/", ignore_errors=True)
    os.makedirs(PERSIST_DIR, exist_ok=True)
    os.chmod(PERSIST_DIR, 0o777)


def cleanup_dirs():
    shutil.rmtree(BASE_PROBE_DIR, ignore_errors=True)
    shutil.rmtree(PERSIST_DIR, ignore_errors=True)


def main():
    setup_dirs()
    report = {"probes": {}, "restoration": {}}
    base_hash = sbx.tree_hash(BASE_PROBE_DIR)
    noremount = variant_init('mount -o remount,bind,ro "$m" 2>/dev/null ||', 'true ||')
    persist = variant_init('mount --bind "$SBX_HOST_WORK" "$SBX_WORK"', f'mount --bind {PERSIST_DIR} "$SBX_WORK"')
    plan = [
        ("EX-S1 network", s1_network, {}, {"unshare_flags": ["--mount", "--pid", "--fork", "--mount-proc", "--ipc", "--uts", "--kill-child"]}),
        ("EX-S2 read-only base", s2_readonly_base, {}, {"init_script": noremount}),
        ("EX-S3 process cap", s3_process_cap, {"caps": {"nproc": 40}}, {"caps": {"nproc": 1000}}),
        ("EX-S4 memory cap", s4_memory_cap, {"caps": {"as_bytes": 256 * 2**20}}, {"caps": {"as_bytes": 64 * 2**30}}),
        ("EX-S5 wall clock", s5_wall_clock, {"caps": {"wall_s": 2}}, {"caps": {"wall_s": 60, "cpu_s": 60}}),
        ("EX-S6 output cap", s6_output_cap, {"caps": {"out_bytes": 4096}}, {"caps": {"out_bytes": 10**7}}),
    ]
    for name, fn, real_kw, broken_kw in plan:
        r = with_dispatch(fn, **real_kw)
        b = with_dispatch(fn, **broken_kw)
        report["probes"][name] = {"real": r, "broken_variant": b, "proves_it_can_fail": not b["ok"]}
        # the broken S2 variant may have written to the stand-in base: remove and prove restoration by hash
        for junk in ("new.txt",):
            jp = os.path.join(BASE_PROBE_DIR, junk)
            if os.path.exists(jp):
                os.remove(jp)
        for junk in ("/etc/sbx-probe", "/usr/sbx-probe"):
            if os.path.exists(junk):
                os.remove(junk)
    r7 = s7_ephemeral()
    b7 = s7_ephemeral(init_script=persist)
    report["probes"]["EX-S7 ephemeral"] = {"real": r7, "broken_variant": b7, "proves_it_can_fail": not b7["ok"]}
    for junk in ("/etc/sbx-probe", "/usr/sbx-probe"):
        assert not os.path.exists(junk), junk
    report["restoration"] = {"stand_in_base_hash_before": base_hash, "after": sbx.tree_hash(BASE_PROBE_DIR), "restored": sbx.tree_hash(BASE_PROBE_DIR) == base_hash,
                             "stray_system_files": [p for p in ("/etc/sbx-probe", "/usr/sbx-probe") if os.path.exists(p)]}
    cleanup_dirs()
    ok = all(v["real"]["ok"] and v["proves_it_can_fail"] for v in report["probes"].values()) and report["restoration"]["restored"]
    report["all_ok"] = ok
    print(json.dumps(report, indent=1, sort_keys=True))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
