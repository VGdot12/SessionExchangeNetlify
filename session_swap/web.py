"""WSGI application: run locally with python -m session_swap, deploy with Gunicorn."""
import hashlib
import hmac
import json
import mimetypes
import os
import re
import threading
import time
import traceback
from collections import defaultdict, deque
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlsplit

from . import db, service
from .importer import import_snapshot

STATIC = Path(__file__).parent / 'static'
attempts = defaultdict(deque)
attempt_lock = threading.Lock()


def limit_login(ip):
    with attempt_lock:
        cutoff = time.monotonic() - 300
        for key in list(attempts):
            while attempts[key] and attempts[key][0] < cutoff:
                attempts[key].popleft()
            if not attempts[key]:
                del attempts[key]
        queue = attempts[ip]
        if len(queue) >= 15:
            raise service.Problem('Too many sign-in attempts. Please try again in five minutes.', 429)
        queue.append(time.monotonic())


def app(environ, start_response):
    headers = [('X-Content-Type-Options', 'nosniff'), ('Referrer-Policy', 'same-origin'),
               ('X-Frame-Options', 'DENY'), ('Cache-Control', 'no-store'),
               ('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")]
    conn = None
    status = 200
    try:
        path, method = environ.get('PATH_INFO', '/'), environ['REQUEST_METHOD']
        demo = os.environ.get('SWAP_DEMO') == '1'
        pgid_only = demo or os.environ.get('SWAP_PGID_ONLY') == '1'
        if method == 'GET' and path in ('/', '/app.js', '/style.css', '/favicon.svg'):
            target = STATIC / ('index.html' if path == '/' else path[1:])
            body = target.read_bytes()
            content_type = mimetypes.guess_type(str(target))[0] or 'application/octet-stream'
        elif path.startswith('/api/'):
            conn = db.connect()
            data = {}
            if method == 'POST':
                if environ.get('CONTENT_TYPE', '').split(';')[0] != 'application/json':
                    raise service.Problem('Send application/json.', 415)
                try:
                    length = int(environ.get('CONTENT_LENGTH') or 0)
                except ValueError:
                    raise service.Problem('Invalid request length.')
                if not 0 < length <= 5_000_000:
                    raise service.Problem('Request must be between 1 byte and 5 MB.', 413)
                try:
                    data = json.loads(environ['wsgi.input'].read(length))
                except (ValueError, UnicodeDecodeError):
                    raise service.Problem('Invalid JSON.')
                if not isinstance(data, dict):
                    raise service.Problem('Expected a JSON object.')
                if path != '/api/admin/import':
                    if environ.get('HTTP_X_SWAP_REQUEST') != '1':
                        raise service.Problem('Refresh the page and try again.', 403)
                    origin = environ.get('HTTP_ORIGIN')
                    if origin and (urlsplit(origin).netloc != environ.get('HTTP_HOST') or urlsplit(origin).scheme not in ('http', 'https')):
                        raise service.Problem('Cross-site requests are not allowed.', 403)
            if path == '/api/config' and method == 'GET':
                result = dict(demo=demo, pgid_only=pgid_only, timezone=os.environ.get('SWAP_TIMEZONE', 'Asia/Kolkata'))
            elif path == '/api/login' and method == 'POST':
                limit_login(environ.get('REMOTE_ADDR', 'unknown'))
                token = service.login(conn, data.get('pgid', ''), data.get('password', ''), pgid_only, data.get('name', ''))
                secure = '; Secure' if os.environ.get('SWAP_SECURE_COOKIE') == '1' else ''
                headers.append(('Set-Cookie', f'swap_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200{secure}'))
                result = dict(ok=True)
            elif path == '/api/admin/import' and method == 'POST':
                configured = os.environ.get('SWAP_ADMIN_TOKEN', '')
                if len(configured) < 32 or not hmac.compare_digest(environ.get('HTTP_AUTHORIZATION', ''), 'Bearer ' + configured):
                    raise service.Problem('Invalid sync token.', 403)
                result = import_snapshot(conn, data)
            else:
                cookies = SimpleCookie()
                try:
                    cookies.load(environ.get('HTTP_COOKIE', ''))
                except Exception:
                    pass
                token = cookies['swap_session'].value if 'swap_session' in cookies else ''
                pgid = service.authenticate(conn, token)
                if path == '/api/state' and method == 'GET':
                    result = service.state(conn, pgid)
                elif path == '/api/logout' and method == 'POST':
                    conn.execute('DELETE FROM logins WHERE token_hash=?', (hashlib.sha256(token.encode()).hexdigest(),))
                    headers.append(('Set-Cookie', 'swap_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'))
                    result = dict(ok=True)
                elif path == '/api/requests' and method == 'POST':
                    result = dict(id=service.create_request(conn, pgid, data))
                    status = 201
                elif re.fullmatch(r'/api/requests/[a-f0-9]{24}/(accept|cancel)', path) and method == 'POST':
                    _, _, _, rid, action = path.split('/')
                    if action == 'accept':
                        service.accept_request(conn, pgid, rid, data.get('accepted_session_id'))
                    else:
                        service.cancel_request(conn, pgid, rid)
                    result = dict(ok=True)
                else:
                    raise service.Problem('Page not found.', 404)
            body, content_type = json.dumps(result).encode(), 'application/json'
        else:
            raise service.Problem('Page not found.', 404)
    except service.Problem as error:
        status, body, content_type = error.status, json.dumps({'error': str(error)}).encode(), 'application/json'
    except Exception:
        traceback.print_exc()
        status, body, content_type = 500, b'{"error":"Something went wrong. Please try again."}', 'application/json'
    finally:
        if conn:
            conn.close()
    labels = {200: 'OK', 201: 'Created', 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Content Too Large', 415: 'Unsupported Media Type', 429: 'Too Many Requests', 500: 'Internal Server Error'}
    headers.extend([('Content-Type', content_type + ('; charset=utf-8' if content_type.startswith(('text/', 'application/json')) else '')), ('Content-Length', str(len(body)))])
    start_response(f'{status} {labels.get(status, "Error")}', headers)
    return [body]


def application(environ, start_response):
    return app(environ, start_response)
