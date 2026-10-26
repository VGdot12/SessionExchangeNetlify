import copy
import io
import json
import os
import tempfile
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path
from unittest.mock import patch

from session_swap import db, service
from session_swap.demo import payload
from session_swap.importer import import_snapshot, read_excel
from session_swap.invites import parse_text, append_to_workbook
from session_swap.web import app, attempts

INVITE = '''Dear Student,
Company Name : Nagarro
Industry : Technology
Event Type : Pre Placement Talk
Event Date : 27 October, 2026
Event Time : 21:30 - 22:30
Duration : 1 hr
Mode : Offline
Venue : TBD
Presenter's Designation : Director

For any queries, please reach out to the coordinator.
'''


class SwapTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = str(Path(self.directory.name) / 'test.sqlite3')
        self.environment = patch.dict(os.environ, {'SWAP_DB': self.path, 'SWAP_DEMO': '1', 'SWAP_TIMEZONE': 'Asia/Kolkata'})
        self.environment.start()
        db.init()
        self.conn = db.connect()
        self.payload = payload()
        import_snapshot(self.conn, self.payload)
        attempts.clear()

    def tearDown(self):
        self.conn.close()
        self.environment.stop()
        self.directory.cleanup()

    def request(self, path, data=None, cookie='', extra=None):
        content = json.dumps(data).encode() if data is not None else b''
        env = {'PATH_INFO': path, 'REQUEST_METHOD': 'POST' if data is not None else 'GET', 'wsgi.input': io.BytesIO(content),
               'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(content)), 'HTTP_COOKIE': cookie,
               'HTTP_X_SWAP_REQUEST': '1', 'HTTP_HOST': 'localhost:8000', 'REMOTE_ADDR': 'test'}
        env.update(extra or {})
        response = {}
        def start(status, headers):
            response.update(status=int(status.split()[0]), headers=dict(headers))
        body = b''.join(app(env, start))
        response['body'] = json.loads(body) if response['headers']['Content-Type'].startswith('application/json') else body
        return response

    def new_request(self, desired='DAT-C'):
        return service.create_request(self.conn, '26002', dict(offered_id='STR-B', desired_id=desired))

    def test_cross_company_swap_disappears_and_is_visible_to_both(self):
        rid = self.new_request()
        service.accept_request(self.conn, '26001', rid, 'DAT-C')
        for pgid in ('26001', '26002'):
            view = service.state(self.conn, pgid)
            self.assertEqual(len(view['requests']), 0)
            self.assertEqual(view['personal'][0]['status'], 'ACCEPTED')
            self.assertEqual(view['personal'][0]['accepted_session']['id'], 'DAT-C')
            self.assertEqual(view['personal'][0]['partner']['pgid'], '26001')
        self.assertIn('STR-B', [r['id'] for r in service.my_sessions(self.conn, '26001')])
        self.assertIn('DAT-C', [r['id'] for r in service.my_sessions(self.conn, '26002')])
        self.assertFalse(service.state(self.conn, '26003')['personal'])

    def test_any_event_uses_explicit_selection(self):
        rid = self.new_request(None)
        with self.assertRaises(service.Problem):
            service.accept_request(self.conn, '26003', rid)
        service.accept_request(self.conn, '26003', rid, 'FIN-A')
        self.assertEqual(self.conn.execute('SELECT accepted_session_id FROM requests WHERE id=?', (rid,)).fetchone()[0], 'FIN-A')

    def test_new_student_can_register_and_self_declare_without_roster(self):
        token = service.login(self.conn, '00999', demo=True, name='Test Student')
        self.assertEqual(service.authenticate(self.conn, token), '00999')
        rid = service.create_request(self.conn, '00999', dict(offered_id='STR-A', desired_id='DAT-B'))
        self.assertTrue(rid)
        self.assertEqual(service.student(self.conn, '00999')['name'], 'Test Student')

    def test_rejects_self_same_event_wrong_target_duplicate_and_bad_id(self):
        rid = self.new_request()
        for pgid, offered in [('26002','DAT-C'), ('26003','STR-B'), ('26001','FIN-A')]:
            with self.assertRaises(service.Problem):
                service.accept_request(self.conn, pgid, rid, offered)
        with self.assertRaises(service.Problem):
            self.new_request()
        for data in [dict(offered_id='STR-A',desired_id='STR-A'),dict(offered_id='missing')]:
            with self.assertRaises(service.Problem):
                service.create_request(self.conn, '26001', data)

    def test_concurrent_acceptance_has_one_winner(self):
        rid = self.new_request(None)
        barrier = threading.Barrier(2)
        def accept(pgid):
            conn = db.connect(self.path)
            try:
                barrier.wait()
                service.accept_request(conn, pgid, rid, 'DAT-C')
                return True
            except service.Problem:
                return False
            finally:
                conn.close()
        with ThreadPoolExecutor(max_workers=2) as executor:
            self.assertEqual(sorted(executor.map(accept, ['26001', '26003'])), [False, True])

    def test_conflicting_post_is_cancelled(self):
        rid = self.new_request()
        own = service.create_request(self.conn, '26001', dict(offered_id='DAT-C'))
        unrelated = service.create_request(self.conn, '26001', dict(offered_id='FIN-A'))
        service.accept_request(self.conn, '26001', rid, 'DAT-C')
        self.assertEqual(self.conn.execute('SELECT status FROM requests WHERE id=?', (own,)).fetchone()[0], 'CANCELLED')
        self.assertEqual(self.conn.execute('SELECT status FROM requests WHERE id=?', (unrelated,)).fetchone()[0], 'OPEN')

    def test_sessions_only_sync_preserves_students_swaps_and_snapshots(self):
        rid = self.new_request()
        service.accept_request(self.conn, '26001', rid, 'DAT-C')
        edited = {'sessions':copy.deepcopy(self.payload['sessions'])}
        edited['sessions'][1]['room'] = 'New room'
        before = service.my_sessions(self.conn, '26001')
        import_snapshot(self.conn, edited)
        self.assertEqual([r['id'] for r in before], [r['id'] for r in service.my_sessions(self.conn, '26001')])
        self.assertEqual(service.student(self.conn, '26001')['name'], 'Aarav Sharma')
        self.assertNotEqual(service.state(self.conn, '26001')['personal'][0]['offered']['room'], 'New room')

    def test_invalid_import_is_atomic_and_removed_sessions_cancel_posts(self):
        rid = self.new_request(None)
        broken = copy.deepcopy(self.payload)
        broken['sessions'][0]['end_time']='01:00'
        with self.assertRaises(service.Problem):
            import_snapshot(self.conn, broken)
        self.assertEqual(len(service.state(self.conn, '26001')['requests']), 1)
        changed = {'sessions':[s for s in self.payload['sessions'] if s['session_id'] != 'STR-B']}
        import_snapshot(self.conn, changed)
        self.assertEqual(self.conn.execute('SELECT status FROM requests WHERE id=?', (rid,)).fetchone()[0], 'CANCELLED')

    def test_past_sessions_expire_requests(self):
        self.new_request()
        self.conn.execute('UPDATE sessions SET date=? WHERE id=?', ((date.today()-timedelta(days=1)).isoformat(), 'STR-B'))
        self.assertEqual(service.state(self.conn, '26002')['personal'][0]['status'], 'EXPIRED')

    def test_only_poster_can_cancel_open_requests(self):
        rid = self.new_request()
        with self.assertRaises(service.Problem):
            service.cancel_request(self.conn, '26001', rid)
        service.accept_request(self.conn, '26001', rid, 'DAT-C')
        with self.assertRaises(service.Problem):
            service.cancel_request(self.conn, '26002', rid)

    def test_http_login_csrf_and_logout(self):
        self.assertEqual(self.request('/api/state')['status'], 401)
        response = self.request('/api/login', {'pgid':'26001'})
        cookie = response['headers']['Set-Cookie'].split(';')[0]
        self.assertIn('HttpOnly', response['headers']['Set-Cookie'])
        self.assertEqual(self.request('/api/state', cookie=cookie)['body']['user']['pgid'], '26001')
        data = {'offered_id':'STR-A'}
        self.assertEqual(self.request('/api/requests', data, cookie, {'HTTP_X_SWAP_REQUEST':''})['status'], 403)
        self.assertEqual(self.request('/api/requests', data, cookie, {'HTTP_ORIGIN':'https://evil.example'})['status'], 403)
        self.assertEqual(self.request('/api/requests', data, cookie)['status'], 201)
        self.assertEqual(self.request('/api/logout', {}, cookie)['status'], 200)
        self.assertEqual(self.request('/api/state', cookie=cookie)['status'], 401)

    def test_password_mode(self):
        with self.assertRaises(service.Problem):
            service.login(self.conn, '26001', 'wrong')
        self.conn.execute('UPDATE students SET password_hash=? WHERE pgid=?', (service.hash_password('a-long-password'), '26001'))
        token = service.login(self.conn, '26001', 'a-long-password')
        self.assertEqual(service.authenticate(self.conn, token), '26001')

    def test_admin_token_and_rate_limit(self):
        self.assertEqual(self.request('/api/admin/import', self.payload)['status'], 403)
        with patch.dict(os.environ, {'SWAP_ADMIN_TOKEN':'x'*40}):
            self.assertEqual(self.request('/api/admin/import', self.payload, extra={'HTTP_AUTHORIZATION':'Bearer '+'x'*40})['status'], 200)
        for _ in range(15):self.request('/api/login', {'pgid':'missing'})
        self.assertEqual(self.request('/api/login', {'pgid':'26001'})['status'], 429)

    def test_screenshot_invite_fields_and_html_equivalent(self):
        result = parse_text(INVITE)
        self.assertEqual(result['session']['title'], 'Nagarro · Pre Placement Talk')
        self.assertEqual(result['session']['date'], '2026-10-27')
        self.assertEqual(result['session']['start_time'], '21:30')
        self.assertEqual(result['session']['end_time'], '22:30')
        self.assertEqual(result['extracted']['mode'], 'Offline')
        self.assertEqual(result['session']['room'], 'TBD')
        self.assertEqual(parse_text('<html><body>'+''.join('<p>'+line+'</p>' for line in INVITE.splitlines())+'</body></html>')['session'], result['session'])

    def test_invite_missing_fields_are_rejected_and_workbook_updates_are_idempotent(self):
        with self.assertRaises(service.Problem):parse_text('Company Name: Test')
        target = Path(self.directory.name)/'events.xlsx'
        result = parse_text(INVITE)
        append_to_workbook(target, result)
        append_to_workbook(target, result)
        self.assertEqual(len(read_excel(target)['sessions']), 1)
        self.assertEqual(read_excel(target)['sessions'][0]['start_time'], '21:30')

    def test_workbook_template_is_importable(self):
        workbook = Path(__file__).parents[1] / 'examples' / 'session-swap-template.xlsx'
        data = read_excel(workbook)
        self.assertEqual(len(data['sessions']), 12)
        self.assertEqual(len(data['students']), 0)


if __name__ == '__main__':unittest.main()
