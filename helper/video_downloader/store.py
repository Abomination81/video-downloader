"""Local job state; credentials and source URLs never enter this database."""
import os
import sqlite3
import time
import uuid
from contextlib import contextmanager

from .config import app_dir, private_dir

ACTIVE = ("queued", "resolving", "downloading", "converting", "cleaning", "verifying", "ready", "finalizing")
TERMINAL = ("done", "error", "cancelled", "interrupted")


@contextmanager
def connection():
    path = private_dir(app_dir() / "state") / "jobs.sqlite3"
    con = sqlite3.connect(path, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA busy_timeout=10000")
    con.executescript("""
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL, title TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
      filename TEXT, error TEXT, detail TEXT, created REAL NOT NULL,
      updated REAL NOT NULL, pid INTEGER, cancel_requested INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS jobs_state_created ON jobs(state, created);
    """)
    if os.name != "nt":
        path.chmod(0o600)
    try:
        yield con
        con.commit()
    finally:
        con.close()


def create(request_id: str, title: str, kind="download") -> tuple[str, bool]:
    now = time.time()
    prefix = "cleanup:" if kind == "cleanup" else ""
    key = prefix + request_id
    with connection() as con:
        con.execute("BEGIN IMMEDIATE")
        previous = con.execute("SELECT id FROM jobs WHERE request_id = ?", (key,)).fetchone()
        if previous:
            return previous["id"], False
        con.execute("UPDATE jobs SET state='interrupted', error='The download was interrupted. Start it again from the video page.' WHERE state IN ('queued','resolving','downloading','converting','cleaning','verifying','finalizing') AND updated < ?", (now - 90,))
        # Cleanup uses its own small pool, so a long video download does not
        # leave a newly saved photograph waiting with private metadata intact.
        active = con.execute("SELECT count(*) FROM jobs WHERE state IN ('queued','resolving','downloading','converting','cleaning','verifying','ready','finalizing') AND (request_id LIKE 'cleanup:%') = ?", (kind == "cleanup",)).fetchone()[0]
        if active >= (2 if kind == "cleanup" else 3):
            raise ValueError("queue_full")
        job_id = uuid.uuid4().hex
        con.execute("INSERT INTO jobs(id,request_id,state,title,created,updated) VALUES(?,?,'queued',?,?,?)", (job_id, key, title, now, now))
        return job_id, True


def update(job_id: str, **fields):
    allowed = {"state", "title", "progress", "filename", "error", "detail", "pid", "cancel_requested"}
    if not fields or not fields.keys() <= allowed:
        raise ValueError("Invalid job update")
    fields["updated"] = time.time()
    # Identifiers are from the fixed internal allowlist; all values are parameters.
    with connection() as con:
        con.execute("UPDATE jobs SET " + ", ".join(key + " = ?" for key in fields) + " WHERE id = ?", (*fields.values(), job_id))


def get(job_id: str):
    with connection() as con:
        row = con.execute("SELECT id,state,title,progress,filename,error,detail,created,updated,pid,cancel_requested FROM jobs WHERE id = ?", (job_id,)).fetchone()
        return dict(row) if row else None


def list_jobs():
    now = time.time()
    with connection() as con:
        con.execute("UPDATE jobs SET state='interrupted', error='The download was interrupted. Start it again from the video page.' WHERE state IN ('queued','resolving','downloading','converting','cleaning','verifying','finalizing') AND updated < ?", (now - 90,))
        con.execute("DELETE FROM jobs WHERE state IN ('done','error','cancelled','interrupted') AND created < ?", (now - 30 * 86400,))
        return [dict(row) for row in con.execute("SELECT id,state,title,progress,filename,error,detail,created FROM jobs ORDER BY CASE WHEN state IN ('queued','resolving','downloading','converting','cleaning','verifying','ready','finalizing') THEN 0 ELSE 1 END, created DESC LIMIT 50")]


def clear():
    with connection() as con:
        con.execute("DELETE FROM jobs WHERE state IN ('done','error','cancelled','interrupted')")
