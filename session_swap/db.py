import json
import os
import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS students (
 pgid TEXT PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 password_hash TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
 id TEXT PRIMARY KEY, course_id TEXT NOT NULL, title TEXT NOT NULL,
 section TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT NOT NULL,
 end_time TEXT NOT NULL, room TEXT NOT NULL DEFAULT '',
 instructor TEXT NOT NULL DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS assignments (
 pgid TEXT NOT NULL REFERENCES students(pgid), slot_id TEXT NOT NULL,
 source_session_id TEXT NOT NULL REFERENCES sessions(id),
 current_session_id TEXT NOT NULL REFERENCES sessions(id),
 PRIMARY KEY(pgid,slot_id)
);
CREATE TABLE IF NOT EXISTS requests (
 id TEXT PRIMARY KEY, poster_pgid TEXT NOT NULL REFERENCES students(pgid),
 course_id TEXT NOT NULL, offered_id TEXT NOT NULL REFERENCES sessions(id),
 desired_id TEXT REFERENCES sessions(id), notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK(status IN ('OPEN','ACCEPTED','CANCELLED','EXPIRED')),
 accepted_by TEXT REFERENCES students(pgid), accepted_session_id TEXT REFERENCES sessions(id),
 created_at TEXT NOT NULL, closed_at TEXT, close_reason TEXT,
 snapshot TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_request ON requests(poster_pgid,offered_id)
 WHERE status='OPEN';
CREATE INDEX IF NOT EXISTS requests_status ON requests(status,created_at);
CREATE INDEX IF NOT EXISTS requests_acceptor ON requests(accepted_by);
CREATE TABLE IF NOT EXISTS logins (
 token_hash TEXT PRIMARY KEY, pgid TEXT NOT NULL REFERENCES students(pgid), expires REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);
"""


def connect(path=None):
    path = str(path or os.environ.get('SWAP_DB', 'data/swaps.sqlite3'))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=15, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys=ON')
    conn.execute('PRAGMA journal_mode=WAL')
    return conn


def init(path=None):
    with closing(connect(path)) as conn:
        conn.executescript(SCHEMA)


@contextmanager
def transaction(conn):
    conn.execute('BEGIN IMMEDIATE')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def metadata(conn):
    return {r['key']: json.loads(r['value']) for r in conn.execute('SELECT * FROM metadata')}


def set_meta(conn, key, value):
    conn.execute('INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
                 (key, json.dumps(value)))
