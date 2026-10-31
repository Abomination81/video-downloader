"""Small, standard-library-only launcher retained across helper updates."""
import json
import os
import re
import shutil
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

VERSION = 1


@contextmanager
def locked(app: Path, name="maintenance.lock", timeout=15):
    app.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (app / name).open("a+b") as handle:
        if handle.seek(0, 2) == 0:
            handle.write(b"\0")
            handle.flush()
        deadline = time.monotonic() + timeout
        while True:
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except (BlockingIOError, OSError):
                if time.monotonic() >= deadline:
                    raise TimeoutError("Another maintenance operation is running") from None
                time.sleep(0.05)
        try:
            yield
        finally:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def atomic_json(path: Path, value):
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with os.fdopen(os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
            json.dump(value, handle, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def pointer(app):
    path = app / "active-runtime.json"
    return json.loads(path.read_text()) if path.exists() else None


def recover(app):
    """Caller holds maintenance.lock. Roll back an interrupted commit."""
    journal = app / "update-journal.json"
    if not journal.exists():
        return
    old = json.loads(journal.read_text())
    backup = app / "extension.previous"
    extension = app / "extension"
    if backup.exists():
        if extension.exists():
            shutil.rmtree(extension)
        backup.rename(extension)
    active = app / "active-runtime.json"
    if old["pointer"] is None:
        active.unlink(missing_ok=True)
    else:
        atomic_json(active, old["pointer"])
    journal.unlink()
    atomic_json(app / "update-state.json", {"state": "error", "message": "An interrupted update was rolled back. Your previous version is still installed.", "updated": time.time()})


def runtime_python(app):
    value = pointer(app)
    base = app / ".venv"
    if value is not None:
        version = value.get("version", "")
        if not re.fullmatch(r"\d+\.\d+\.\d+", version):
            raise ValueError("Invalid active runtime")
        base = app / "runtimes" / version / ".venv"
    return base / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def main():
    app = Path(__file__).resolve().parent
    with locked(app):
        recover(app)
        python = runtime_python(app)
        if not python.is_file():
            raise RuntimeError("The installed helper runtime is missing")
    os.execv(str(python), [str(python), "-m", "video_downloader.native", *sys.argv[1:]])


if __name__ == "__main__":
    main()
