import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from .db import metadata, transaction


class Problem(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def now():
    return datetime.now(timezone.utc).isoformat()


def future(session):
    start = datetime.fromisoformat(session['date'] + 'T' + session['start_time'])
    return start.replace(tzinfo=ZoneInfo(os.environ.get('SWAP_TIMEZONE', 'Asia/Kolkata'))) > datetime.now(timezone.utc)


def student(conn, pgid):
    row = conn.execute('SELECT pgid,name FROM students WHERE pgid=? AND active=1', (pgid,)).fetchone()
    if not row:
        raise Problem('Student not found in the current roster.', 401)
    return dict(row)


def session(conn, sid):
    row = conn.execute('SELECT * FROM sessions WHERE id=?', (sid,)).fetchone()
    if not row:
        raise Problem('Session not found.', 404)
    return dict(row)


def active_session(conn, sid):
    row = session(conn, sid)
    if not row['active'] or not future(row):
        raise Problem('This session is no longer available for swapping.', 409)
    return row


def clean_expired(conn):
    ids = [r['id'] for r in conn.execute("SELECT id FROM sessions WHERE active=1") if not future(session(conn, r['id']))]
    if ids:
        marks = ','.join('?' for _ in ids)
        conn.execute(f"UPDATE requests SET status='EXPIRED',closed_at=?,close_reason='Session has started' WHERE status='OPEN' AND (offered_id IN ({marks}) OR desired_id IN ({marks}))", (now(), *ids, *ids))


def assignment(conn, pgid, course_id):
    row = conn.execute('SELECT * FROM assignments WHERE pgid=? AND slot_id=?', (pgid, course_id)).fetchone()
    return dict(row) if row else None


def my_sessions(conn, pgid):
    return [dict(r) for r in conn.execute('SELECT s.* FROM sessions s JOIN assignments a ON a.current_session_id=s.id WHERE a.pgid=? AND s.active=1 ORDER BY s.date,s.start_time', (pgid,))]


def request_view(conn, row, viewer):
    item = dict(row)
    snap = json.loads(item.pop('snapshot')) if item.get('snapshot') else None
    item.pop('snapshot', None)
    item['offered'] = snap['offered'] if snap else session(conn, item['offered_id'])
    item['desired'] = (snap['desired'] if snap else session(conn, item['desired_id'])) if item['desired_id'] else None
    poster = conn.execute('SELECT pgid,name FROM students WHERE pgid=?', (item['poster_pgid'],)).fetchone()
    item['poster'] = snap['poster'] if snap else dict(poster)
    item['partner'] = None
    item['accepted_session'] = None
    if item['accepted_by']:
        partner = conn.execute('SELECT pgid,name FROM students WHERE pgid=?', (item['accepted_by'],)).fetchone()
        item['partner'] = snap['partner'] if snap else dict(partner)
        item['accepted_session'] = snap['accepted_session'] if snap else session(conn, item['accepted_session_id'])
    item['can_accept'] = False
    reason = 'This request is closed.'
    if item['status'] == 'OPEN':
        if viewer == item['poster_pgid']:
            reason = 'This is your request.'
        else:
            item['can_accept'] = True
            reason = ''
    item['accept_reason'] = reason
    item['your_session'] = None
    return item


def state(conn, pgid):
    clean_expired(conn)
    user = student(conn, pgid)
    public = [request_view(conn, r, pgid) for r in conn.execute("SELECT * FROM requests WHERE status='OPEN' ORDER BY created_at DESC")]
    personal = [request_view(conn, r, pgid) for r in conn.execute('SELECT * FROM requests WHERE poster_pgid=? OR accepted_by=? ORDER BY created_at DESC', (pgid, pgid))]
    return dict(user=user, requests=public, personal=personal, assignments=my_sessions(conn, pgid),
                sessions=[dict(r) for r in conn.execute('SELECT * FROM sessions WHERE active=1 ORDER BY date,start_time') if future(r)],
                metadata=metadata(conn))


def create_request(conn, pgid, data):
    offered_id = data.get('offered_id')
    desired_id = data.get('desired_id') or None
    notes = data.get('notes', '')
    if not isinstance(notes, str) or len(notes) > 300:
        raise Problem('Notes must be 300 characters or fewer.')
    if not isinstance(offered_id, str) or (desired_id is not None and not isinstance(desired_id, str)):
        raise Problem('Choose a session from the list.')
    with transaction(conn):
        clean_expired(conn)
        offered = active_session(conn, offered_id)
        if desired_id:
            desired = active_session(conn, desired_id)
            if desired_id == offered_id:
                raise Problem('Choose a different event or section.')
        elif not any(s['id'] != offered_id for s in (dict(r) for r in conn.execute('SELECT * FROM sessions WHERE active=1')) if future(s)):
            raise Problem('There are no other upcoming events for a swap.')
        rid = secrets.token_hex(12)
        try:
            conn.execute("INSERT INTO requests(id,poster_pgid,course_id,offered_id,desired_id,notes,status,created_at) VALUES (?,?,?,?,?,?,'OPEN',?)", (rid, pgid, offered['course_id'], offered_id, desired_id, notes.strip(), now()))
        except sqlite3.IntegrityError:
            raise Problem('You already have an open request for this event. Cancel it before posting another.', 409)
        conn.execute('INSERT INTO assignments VALUES (?,?,?,?) ON CONFLICT(pgid,slot_id) DO UPDATE SET source_session_id=excluded.source_session_id,current_session_id=excluded.current_session_id', (pgid, offered_id, offered_id, offered_id))
    return rid


def accept_request(conn, pgid, rid, accepted_session_id=None):
    with transaction(conn):
        clean_expired(conn)
        row = conn.execute('SELECT * FROM requests WHERE id=?', (rid,)).fetchone()
        if not row:
            raise Problem('Request not found.', 404)
        if row['status'] != 'OPEN':
            raise Problem('This request is no longer open. Refresh to see available swaps.', 409)
        view = request_view(conn, row, pgid)
        if not view['can_accept']:
            raise Problem(view['accept_reason'], 403)
        offer = active_session(conn, row['offered_id'])
        if accepted_session_id is None:
            accepted_session_id = row['desired_id']
        if not isinstance(accepted_session_id, str):
            raise Problem('Select the assigned event you are offering in exchange.')
        other = active_session(conn, accepted_session_id)
        if other['id'] == offer['id']:
            raise Problem('Select a different event or section.')
        if row['desired_id'] and other['id'] != row['desired_id']:
            raise Problem('The event you offer must match the requested event.')
        snapshot = dict(offered=offer, desired=view['desired'], accepted_session=other,
                        poster=student(conn, row['poster_pgid']), partner=student(conn, pgid))
        conn.execute("UPDATE requests SET status='ACCEPTED',accepted_by=?,accepted_session_id=?,closed_at=?,snapshot=? WHERE id=? AND status='OPEN'", (pgid, other['id'], now(), json.dumps(snapshot), rid))
        # Each student declares the event they hold. Each event is a separate slot.
        conn.execute('DELETE FROM assignments WHERE pgid=? AND current_session_id=?', (row['poster_pgid'], offer['id']))
        conn.execute('DELETE FROM assignments WHERE pgid=? AND current_session_id=?', (pgid, other['id']))
        for owner, source, received in [(row['poster_pgid'], offer['id'], other['id']), (pgid, other['id'], offer['id'])]:
            conn.execute('INSERT INTO assignments VALUES (?,?,?,?) ON CONFLICT(pgid,slot_id) DO UPDATE SET current_session_id=excluded.current_session_id', (owner, source, source, received))
        conn.execute("UPDATE requests SET status='CANCELLED',closed_at=?,close_reason='Another swap changed your declared event' WHERE status='OPEN' AND ((poster_pgid=? AND offered_id=?) OR (poster_pgid=? AND offered_id=?))", (now(), pgid, other['id'], row['poster_pgid'], offer['id']))


def cancel_request(conn, pgid, rid):
    with transaction(conn):
        row = conn.execute('SELECT * FROM requests WHERE id=?', (rid,)).fetchone()
        if not row or row['poster_pgid'] != pgid:
            raise Problem('Request not found.', 404)
        if row['status'] != 'OPEN':
            raise Problem('Only open requests can be cancelled.', 409)
        conn.execute("UPDATE requests SET status='CANCELLED',closed_at=?,close_reason='Cancelled by you' WHERE id=?", (now(), rid))


def hash_password(password):
    if len(password) < 10:
        raise Problem('Use a password of at least 10 characters.')
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600_000).hex()
    return f'{salt}${digest}'


def password_matches(password, stored):
    salt, digest = (stored or ('0' * 32 + '$' + '0' * 64)).split('$')
    actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600_000).hex()
    return hmac.compare_digest(actual, digest)


def login(conn, pgid, password='', demo=False, name=''):
    if not isinstance(pgid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,40}', pgid):
        raise Problem('Enter a valid PGID.', 401)
    if not isinstance(password, str) or len(password) > 500:
        raise Problem('Invalid credentials.', 401)
    row = conn.execute('SELECT * FROM students WHERE pgid=? AND active=1', (pgid,)).fetchone()
    if not isinstance(name, str) or len(name) > 100:
        raise Problem('Enter a name of 100 characters or fewer.')
    if not row and demo:
        if not name.strip() or len(name.strip()) < 2:
            raise Problem('Enter your name to use this PGID for the first time.')
        conn.execute('INSERT INTO students(pgid,name) VALUES (?,?) ON CONFLICT(pgid) DO UPDATE SET name=excluded.name,active=1', (pgid, name.strip()))
        row = conn.execute('SELECT * FROM students WHERE pgid=?', (pgid,)).fetchone()
    valid_password = True if demo else password_matches(password, row['password_hash'] if row else None)
    if not row or not valid_password:
        raise Problem('PGID or password not recognised. Contact the coordinator if you need access.', 401)
    token = secrets.token_urlsafe(32)
    conn.execute('DELETE FROM logins WHERE expires<?', (time.time(),))
    conn.execute('INSERT INTO logins VALUES (?,?,?)', (hashlib.sha256(token.encode()).hexdigest(), pgid, time.time() + 43200))
    return token


def authenticate(conn, token):
    row = conn.execute('SELECT l.pgid FROM logins l JOIN students s ON s.pgid=l.pgid WHERE l.token_hash=? AND l.expires>? AND s.active=1', (hashlib.sha256(token.encode()).hexdigest(), time.time())).fetchone()
    if not row:
        raise Problem('Please enter your PGID to continue.', 401)
    return row['pgid']
