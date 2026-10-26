"""Apply messages retrieved through the user's connected Outlook account.

Mailbox authentication and retrieval are supplied by the scheduled agent. This
module validates the retrieved envelope and body, writes Excel, and checkpoints.
"""
import hashlib
import json
import os
import re
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .invites import append_to_workbook, parse_text
from .service import Problem

SENDER = 'casevents@isb.edu'


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        raise Problem('received_at must be an ISO timestamp with a timezone.')


def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent, delete=False)
    try:
        with handle:
            json.dump(state, handle, ensure_ascii=False, indent=2)
        os.replace(handle.name, path)
    finally:
        Path(handle.name).unlink(missing_ok=True)


@contextmanager
def exclusive(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise Problem('Another Outlook import holds the workbook lock. If a run crashed, inspect the .lock file before removing it.')
    try:
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        yield
    finally:
        path.unlink(missing_ok=True)


def import_messages(messages, workbook, state_path, apply=False):
    if not isinstance(messages, list) or len(messages) > 500:
        raise Problem('Provide a JSON list of at most 500 retrieved messages per batch.')
    for message in messages:
        if not isinstance(message, dict):
            raise Problem('Each message must be an object.')
        for key, limit in [('id', 2000), ('sender', 320), ('subject', 1000), ('received_at', 100), ('body', 500000)]:
            if not isinstance(message.get(key), str) or not 0 < len(message[key]) <= limit:
                raise Problem(f'Each message needs a non-empty {key} of at most {limit} characters.')
        timestamp(message['received_at'])
    workbook, state_path = Path(workbook), Path(state_path)
    if workbook.suffix.lower() != '.xlsx':
        raise Problem('Choose an .xlsx workbook.')
    with exclusive(Path(str(workbook) + '.lock')):
        state = json.loads(state_path.read_text()) if state_path.exists() else {'processed': {}, 'reviews': []}
        report = {'updated': [], 'skipped': 0, 'reviews': [], 'dry_run': not apply}
        # Sources written previously protect against older messages overwriting newer data.
        # The four-column workbook keeps provenance in this private checkpoint.
        latest = {sid: timestamp(value) for sid, value in state.get('latest_events', {}).items()}
        if workbook.exists():
            from openpyxl import load_workbook
            wb = load_workbook(workbook, read_only=True, data_only=False)
            try:
                rows = wb['Sessions'].iter_rows(values_only=True)
                headings = next(rows)
                for values in rows:
                    row = dict(zip(headings, values))
                    if row.get('session_id') and row.get('source_received_at'):
                        sid = row['session_id']
                        latest[sid] = max(latest.get(sid, timestamp(row['source_received_at'])), timestamp(row['source_received_at']))
            finally:
                wb.close()
        for message in sorted(messages, key=lambda m: timestamp(m['received_at'])):
            if message['sender'].strip().lower() != SENDER:
                report['skipped'] += 1
                continue
            key = hashlib.sha256(message['id'].encode()).hexdigest()
            digest = hashlib.sha256(json.dumps(message, sort_keys=True).encode()).hexdigest()
            if state['processed'].get(key, {}).get('digest') == digest:
                report['skipped'] += 1
                continue
            subject = message['subject'].lower()
            result = None
            reason = None
            if re.search(r'cancel|reschedul|postpon|revis|correction|updated', subject):
                reason = 'Changed or cancelled invite needs review; the schedule was not changed.'
            elif 'upcoming event' not in subject:
                report['skipped'] += 1
                continue
            else:
                try:
                    result = parse_text(message['body'])
                    if re.search(r'\b(cancelled|canceled|postponed|rescheduled)\b', message['body'], re.I):
                        reason = 'Body mentions a cancellation or reschedule; review before changing the schedule.'
                    elif re.search(r'\bsection\s*[:\-]?\s*[A-Z0-9]+', message['body'], re.I):
                        reason = 'Invite mentions sections. Confirm the section labels before importing.'
                except Problem as error:
                    reason = str(error)
            if reason:
                review = dict(message_id=message['id'], subject=message['subject'], received_at=message['received_at'], reason=reason)
                report['reviews'].append(review)
                state['reviews'] = [r for r in state['reviews'] if r['message_id'] != message['id']] + [review]
            elif result:
                sid = result['session']['session_id']
                received = timestamp(message['received_at'])
                if sid in latest and received < latest[sid]:
                    report['skipped'] += 1
                else:
                    result['source'] = message
                    if apply:
                        append_to_workbook(workbook, result)
                    latest[sid] = received
                    state.setdefault('latest_events', {})[sid] = message['received_at']
                    report['updated'].append(sid)
                    state['reviews'] = [r for r in state['reviews'] if r['message_id'] != message['id']]
            state['processed'][key] = dict(digest=digest, received_at=message['received_at'])
            if apply:
                # Written after Excel: replay after a crash updates the same stable row.
                save_state(state_path, state)
        if apply:
            state['last_batch_at'] = datetime.now(timezone.utc).isoformat()
            save_state(state_path, state)
        return report
