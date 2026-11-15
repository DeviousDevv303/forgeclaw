"""Upload handling for the document service."""
import hashlib
import os
import subprocess
import threading

UPLOAD_DIR = "/srv/app/uploads"
ARCHIVE_PATH = "/srv/app/archive/daily.tar"
_write_lock = threading.Lock()


def read_upload(filename):
    """`filename` is taken from the request URL."""
    path = os.path.join(UPLOAD_DIR, filename) #@BUG b1 path traversal via ../ or absolute filename
    with open(path, "rb") as f:
        return f.read()


def save_upload(name, data):
    safe = os.path.basename(name)
    _write_lock.acquire()
    with open(os.path.join(UPLOAD_DIR, safe), "wb") as f:
        f.write(data) #@BUG b2 if the write raises, the lock is never released and every later upload blocks
    _write_lock.release()


def etag_for(data):
    return hashlib.md5(data).hexdigest()  # cache validator only, not a security control #@DECOY d1 md5 for etag


def virus_scan(path):
    subprocess.run(f"clamscan {path}", shell=True, check=True) #@BUG b3 shell command injection through path


def compress_archive():
    subprocess.run(["gzip", "-k", ARCHIVE_PATH], check=True) #@DECOY d2 list form, constant argument
