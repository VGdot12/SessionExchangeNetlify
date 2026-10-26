import copy
import json
import tempfile
import unittest
from pathlib import Path

from openpyxl import load_workbook
from session_swap.automation import import_messages
from session_swap.importer import read_excel
from session_swap.service import Problem
from test_app import INVITE


class OutlookIntakeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.workbook = Path(self.temp.name)/'sessions.xlsx'
        self.state = Path(self.temp.name)/'state.json'
        self.message = dict(id='message-1', sender='casevents@isb.edu',
                            subject='Upcoming Event | PGP Co 2027 | Pre Placement Talk',
                            received_at='2026-10-26T10:49:00Z', body=INVITE)

    def tearDown(self):
        self.temp.cleanup()

    def run_import(self, message=None, apply=True):
        return import_messages([message or self.message], self.workbook, self.state, apply)

    def test_duplicate_messages_do_not_add_rows(self):
        first=self.run_import()
        second=self.run_import()
        self.assertEqual(len(first['updated']), 1)
        self.assertEqual(second['updated'], [])
        self.assertEqual(second['skipped'], 1)
        self.assertEqual(len(read_excel(self.workbook)['sessions']), 1)

    def test_source_metadata_and_literal_strings_are_written(self):
        self.run_import()
        wb=load_workbook(self.workbook,read_only=True,data_only=False)
        try:
            rows=list(wb['Sessions'].values)
            row=dict(zip(rows[0],rows[1]))
            self.assertEqual(row['source_message_id'], 'message-1')
            self.assertEqual(row['company'], 'Nagarro')
            self.assertEqual(row['mode'], 'Offline')
        finally:wb.close()

    def test_updated_venue_is_upserted_but_older_message_cannot_regress_it(self):
        self.run_import()
        newer=copy.deepcopy(self.message)
        newer.update(id='message-2',received_at='2026-10-26T12:00:00Z',body=INVITE.replace('Venue : TBD','Venue : LT 3'))
        self.run_import(newer)
        older=copy.deepcopy(self.message)
        older['id']='old-message-found-late'
        self.assertEqual(self.run_import(older)['skipped'],1)
        self.assertEqual(read_excel(self.workbook)['sessions'][0]['room'],'LT 3')

    def test_cancellation_and_malformed_invites_enter_review_once(self):
        self.run_import()
        cancelled=copy.deepcopy(self.message)
        cancelled.update(id='cancel-1',subject='Cancelled: Upcoming Event | Nagarro')
        self.assertEqual(len(self.run_import(cancelled)['reviews']),1)
        self.assertEqual(self.run_import(cancelled)['reviews'],[])
        malformed=copy.deepcopy(self.message)
        malformed.update(id='bad-1',body='No labelled event fields here')
        self.assertEqual(len(self.run_import(malformed)['reviews']),1)
        self.assertEqual(len(read_excel(self.workbook)['sessions']),1)
        self.assertEqual(len(json.loads(self.state.read_text())['reviews']),2)

    def test_dry_run_and_wrong_sender_do_not_write(self):
        self.assertEqual(len(self.run_import(apply=False)['updated']),1)
        self.assertFalse(self.workbook.exists())
        self.assertFalse(self.state.exists())
        ignored=copy.deepcopy(self.message)
        ignored['sender']='other@example.com'
        self.assertEqual(self.run_import(ignored)['skipped'],1)
        self.assertFalse(self.workbook.exists())

    def test_invalid_envelope_and_concurrent_writer_are_rejected(self):
        broken=copy.deepcopy(self.message)
        broken['received_at']='no date'
        with self.assertRaises(Problem):self.run_import(broken)
        lock=Path(str(self.workbook)+'.lock')
        lock.write_text('another-writer')
        with self.assertRaises(Problem):self.run_import()
        self.assertEqual(lock.read_text(),'another-writer')


if __name__=='__main__':unittest.main()
