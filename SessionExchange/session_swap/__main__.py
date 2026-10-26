import argparse
import getpass
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from socketserver import ThreadingMixIn
from urllib.parse import urlsplit
from wsgiref.simple_server import WSGIServer, make_server

from . import db
from .importer import import_snapshot, read_excel
from .service import Problem, hash_password


def main():
    parser = argparse.ArgumentParser(description='Session Swap: student session exchange')
    parser.add_argument('--db', default=os.environ.get('SWAP_DB', 'data/swaps.sqlite3'))
    sub = parser.add_subparsers(dest='command', required=True)
    serve = sub.add_parser('serve', help='Run the app')
    serve.add_argument('--demo', action='store_true')
    serve.add_argument('--pgid-only', action='store_true', help='Prototype sign-in using PGID alone')
    serve.add_argument('--port', type=int, default=8000)
    serve.add_argument('--host', default='127.0.0.1')
    sub.add_parser('init', help='Create database tables')
    imp = sub.add_parser('import', help='Import a complete local Excel snapshot')
    imp.add_argument('file')
    imp.add_argument('--dry-run', action='store_true')
    password = sub.add_parser('set-password', help='Set a student password securely')
    password.add_argument('pgid')
    sync = sub.add_parser('sync', help='Send local Excel changes to a hosted server')
    sync.add_argument('file')
    sync.add_argument('--url', required=True)
    sync.add_argument('--watch', action='store_true')
    sync.add_argument('--interval', type=int, default=300)
    invite = sub.add_parser('parse-invite', help='Preview a saved Outlook .eml or text invite')
    invite.add_argument('file')
    invite.add_argument('--section', default='Main')
    invite.add_argument('--workbook', help='Append/update this .xlsx after you review the preview')
    invite.add_argument('--apply', action='store_true', help='Write the reviewed event to --workbook')
    args = parser.parse_args()
    os.environ['SWAP_DB'] = args.db
    if args.command == 'parse-invite':
        from .invites import append_to_workbook, read_invite
        result = read_invite(args.file, args.section)
        if args.apply:
            if not args.workbook:
                parser.error('--apply requires --workbook.')
            print('Saved event: ' + append_to_workbook(args.workbook, result))
        else:
            print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    if args.command == 'sync':
        url = urlsplit(args.url)
        if url.username or url.password or url.query or url.fragment or url.path not in ('', '/') or (url.scheme != 'https' and not (url.scheme == 'http' and url.hostname in ('localhost', '127.0.0.1', '::1'))):
            parser.error('--url must be an HTTPS origin (HTTP is allowed only on localhost).')
        token = os.environ.get('SWAP_ADMIN_TOKEN', '')
        if len(token) < 32:
            parser.error('Set SWAP_ADMIN_TOKEN in your environment (at least 32 characters).')
        if args.interval < 10:
            parser.error('--interval must be at least 10 seconds.')
        last_digest = None
        while True:
            try:
                digest = hashlib.sha256(Path(args.file).read_bytes()).hexdigest()
                if digest != last_digest:
                    content = json.dumps(read_excel(args.file)).encode()
                    request = urllib.request.Request(args.url.rstrip('/') + '/api/admin/import', data=content,
                        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token}, method='POST')
                    # Never forward the sync credential to a redirect target.
                    class NoRedirect(urllib.request.HTTPRedirectHandler):
                        def redirect_request(self, req, fp, code, msg, headers, newurl):
                            return None
                    opener = urllib.request.build_opener(NoRedirect)
                    with opener.open(request, timeout=45) as response:
                        print(response.read().decode(), flush=True)
                    last_digest = digest
            except (OSError, ValueError, Problem, urllib.error.URLError) as error:
                print(f'Sync failed: {error}. Last successful server data remains unchanged.', file=sys.stderr, flush=True)
                if not args.watch:
                    return 1
            if not args.watch:
                return 0
            time.sleep(args.interval)
    db.init(args.db)
    if args.command == 'import':
        content = read_excel(args.file)
        if args.dry_run:
            print(json.dumps({k: len(v) for k, v in content.items()}))
        else:
            with db.connect() as conn:
                print(json.dumps(import_snapshot(conn, content, source='Local Excel import')))
    elif args.command == 'set-password':
        with db.connect() as conn:
            if not conn.execute('SELECT 1 FROM students WHERE pgid=? AND active=1', (args.pgid,)).fetchone():
                parser.error('PGID is not in the active roster. Import the workbook first.')
            first = getpass.getpass('New password (10+ characters): ')
            if first != getpass.getpass('Repeat password: '):
                parser.error('Passwords do not match.')
            conn.execute('UPDATE students SET password_hash=? WHERE pgid=?', (hash_password(first), args.pgid))
            conn.execute('DELETE FROM logins WHERE pgid=?', (args.pgid,))
            print('Password updated; existing sign-ins revoked.')
    elif args.command == 'serve':
        if args.pgid_only:
            os.environ['SWAP_PGID_ONLY'] = '1'
        if args.demo:
            if args.host not in ('127.0.0.1', 'localhost', '::1'):
                parser.error('Demo mode must use a loopback host.')
            from .demo import seed
            with db.connect() as conn:
                seed(conn)
            os.environ['SWAP_DEMO'] = '1'
        elif os.environ.get('SWAP_DEMO') == '1':
            parser.error('Use the explicit --demo flag to enable PGID-only demo mode.')
        from .web import app
        class ThreadedServer(ThreadingMixIn, WSGIServer):
            daemon_threads = True
        with make_server(args.host, args.port, app, server_class=ThreadedServer) as server:
            print(f'Session Swap: http://{args.host}:{args.port}', flush=True)
            print('Demo: try PGID 26001. Sample students and sessions only.' if args.demo else 'PGID-only prototype sign-in enabled.' if os.environ.get('SWAP_PGID_ONLY') == '1' else 'Password sign-in enabled.', flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (Problem, OSError, ValueError, RuntimeError) as error:
        print(f'Error: {error}', file=sys.stderr)
        raise SystemExit(1)
