from datetime import date, timedelta

from .db import metadata, set_meta, transaction
from .importer import import_snapshot
from .service import create_request


def payload():
    courses = [('STR', 'Strategic Thinking', 'Prof. Meera Shah', 'LT 201'), ('DAT', 'Data-driven Decisions', 'Prof. Arjun Rao', 'LT 104'), ('COM', 'Leadership Communication', 'Prof. Kavya Iyer', 'Seminar Hall'), ('FIN', 'Finance Fundamentals', 'Prof. Rohan Das', 'LT 302')]
    sessions = []
    for i, (code, title, instructor, room) in enumerate(courses):
        for j, section in enumerate(('A', 'B', 'C')):
            sessions.append(dict(session_id=f'{code}-{section}', course_id=code, title=title, section=section,
                                 date=(date.today() + timedelta(days=3 + i)).isoformat(), start_time=['09:00', '11:00', '14:00'][j],
                                 end_time=['10:30', '12:30', '15:30'][j], room=room, instructor=instructor))
    names = ['Aarav Sharma', 'Ananya Patel', 'Riya Mehta', 'Kabir Sethi', 'Ishaan Nair', 'Sara Khan']
    students = [dict(pgid=f'2600{i+1}', name=n) for i, n in enumerate(names)]
    return dict(sessions=sessions, students=students, assignments=[])


def seed(conn):
    if conn.execute('SELECT COUNT(*) FROM students').fetchone()[0]:
        if not metadata(conn).get('demo'):
            raise RuntimeError('Demo mode requires an empty database or an existing demo database. Use a separate --db path.')
        return
    import_snapshot(conn, payload(), source='Sample workbook · fictional students')
    with transaction(conn):
        set_meta(conn, 'demo', True)
    create_request(conn, '26002', {'offered_id': 'STR-B', 'desired_id': 'DAT-B', 'notes': 'Interested in the data session instead. Happy to swap!'})
    create_request(conn, '26003', {'offered_id': 'DAT-A', 'desired_id': None, 'notes': 'Flexible on the section. Looking for a different time.'})
    create_request(conn, '26004', {'offered_id': 'COM-C', 'desired_id': 'COM-A', 'notes': 'The earlier section works better with my schedule.'})
    create_request(conn, '26005', {'offered_id': 'FIN-B', 'desired_id': None, 'notes': ''})
    create_request(conn, '26006', {'offered_id': 'STR-C', 'desired_id': None, 'notes': 'Open to either of the other sections.'})
