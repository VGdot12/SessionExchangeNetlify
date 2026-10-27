"""Read the uploaded workbook without copying email or student data into JSON."""
import json
import re
import sys
import zipfile
from datetime import date, datetime
from pathlib import Path

from .importer import HEADERS, SIMPLE_HEADERS, simple_session, validate
from .service import Problem

INVITE_HEADERS = ['company name', 'event type', 'event date', 'event time', 'venue']


class WorkbookValidationError(Problem):
    """Messages contain only fixed instructions, field names and row numbers."""


def heading(value):
    text = str(value or '').replace('\ufeff', '').replace('\u200b', '')
    return re.sub(r'\s+', ' ', text).strip().lower()


def event_date(value):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = re.sub(r'\s+', ' ', str(value or '').replace(',', ' ')).strip()
    for fmt in ('%Y-%m-%d', '%d %B %Y', '%d %b %Y', '%d/%m/%Y', '%d-%m-%Y'):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass
    raise WorkbookValidationError('Event Date/date: use an Excel date, YYYY-MM-DD, DD/MM/YYYY or a date such as 27 October, 2026.')


def checked_session(session, row_number):
    for field in HEADERS['Sessions']:
        value = session.get(field, '')
        if not isinstance(value, str) or len(value) > 200:
            raise WorkbookValidationError(f'Row {row_number}: {field} must be text of 200 characters or fewer.')
        if field not in ('room', 'instructor') and not value.strip():
            raise WorkbookValidationError(f'Row {row_number}: {field} is empty. Fill in the required value.')
    try:
        validate({'sessions': [session]})
    except Problem:
        raise WorkbookValidationError(f'Row {row_number}: invalid session date or time. Use a valid date and a same-day 24-hour time range.') from None
    return session


def read_uploaded_workbook(path):
    from openpyxl import load_workbook
    path = Path(path)
    if path.suffix.lower() != '.xlsx' or path.stat().st_size > 10_000_000:
        raise WorkbookValidationError('Upload an .xlsx workbook smaller than 10 MB.')
    with zipfile.ZipFile(path) as archive:
        if sum(i.file_size for i in archive.infolist()) > 30_000_000:
            raise WorkbookValidationError('Workbook exceeds the 30 MB uncompressed limit.')
    wb = load_workbook(path, read_only=True, data_only=False)
    try:
        supported = []
        recognized = set()
        for sheet in wb:
            if sheet.max_column and sheet.max_column > 50:
                continue
            for header_row, values in enumerate(sheet.iter_rows(max_row=50, max_col=50, values_only=True), 1):
                headers = [heading(v) for v in values]
                recognized.update(h for h in headers if h in INVITE_HEADERS or h in SIMPLE_HEADERS or h in HEADERS['Sessions'])
                required = next((h for h in (INVITE_HEADERS, HEADERS['Sessions'], SIMPLE_HEADERS) if all(k in headers for k in h)), None)
                if required:
                    supported.append((sheet, headers, required, header_row))
                    break
        preferred = [entry for entry in supported if entry[0].title == 'Sessions']
        choices = preferred or supported
        if not choices:
            missing = ', '.join(h for h in INVITE_HEADERS if h not in recognized)
            raise WorkbookValidationError('No supported header row found in the first 50 rows. Use Company Name, Event Type, Event Date, Event Time, Venue; '
                                          'or title, room, time, date. Missing invite headings: ' + (missing or 'check that they are together on one sheet') + '.')
        if len(choices) > 1:
            raise WorkbookValidationError('Several sheets have session columns. Name the intended sheet Sessions to select it.')
        sheet, headers, required, header_row = choices[0]
        if len([h for h in headers if h]) != len(set(h for h in headers if h)):
            raise WorkbookValidationError(f'The selected sheet has duplicate column headings in row {header_row}. Give each column a unique heading.')
        sessions = {}
        first_rows = {}
        rows = sheet.iter_rows(min_row=header_row + 1, values_only=True)
        for number, values in enumerate(rows, header_row + 1):
            if number > header_row + 20000:
                raise WorkbookValidationError('Limit the workbook to 20,000 data rows.')
            if not any(v is not None and str(v).strip() for v in values):
                continue
            def cell(name):
                i = headers.index(name)
                value = values[i] if i < len(values) else None
                if isinstance(value, str) and value.startswith('='):
                    raise WorkbookValidationError(f'Row {number}, {name}: formulas are not supported. Replace the formula with its value.')
                return value
            # Manual workbook uploads import all valid session rows. Subject,
            # Duration and other email metadata are deliberately not read.
            record = {k: cell(k) for k in required}
            try:
                if required == INVITE_HEADERS:
                    company, kind = [str(record[k] or '').strip() for k in ('company name', 'event type')]
                    if not company or not kind:
                        raise WorkbookValidationError('Company Name and Event Type are required and cannot be empty.')
                    record = dict(title=f'{company} · {kind}', room=str(record['venue'] or '').strip(),
                                  date=event_date(record['event date']), time=str(record['event time'] or '').strip())
                    session = simple_session(record, number)
                elif required == SIMPLE_HEADERS:
                    record['date'] = event_date(record['date'])
                    session = simple_session({k: str(v or '').strip() for k, v in record.items()}, number)
                else:
                    from datetime import time
                    record['date'] = event_date(record['date'])
                    session = {k: v.isoformat(timespec='minutes') if isinstance(v, time) else str(v or '').strip() for k, v in record.items()}
                if 'session_id' in headers and required != HEADERS['Sessions']:
                    explicit = str(cell('session_id') or '').strip()
                    if explicit:
                        session['session_id'] = session['course_id'] = explicit
                session['instructor'] = ''
                checked_session(session, number)
                previous = sessions.get(session['session_id'])
                if previous and previous != session:
                    raise WorkbookValidationError(f'Rows {first_rows[session["session_id"]]} and {number} identify the same event but have different details. Keep one current row for that event.')
                sessions[session['session_id']] = session
                first_rows.setdefault(session['session_id'], number)
            except Problem as error:
                if isinstance(error, WorkbookValidationError):
                    if str(error).startswith(('Row ', 'Rows ')):
                        raise
                    raise WorkbookValidationError(f'Row {number}: {error}') from None
                # simple_session's fixed format guidance contains no cell values.
                raise WorkbookValidationError(f'Row {number}, Event Time/time: enter both start and end, for example 08:30 - 09:30, using same-day 24-hour times. A single start time is not enough; Duration is not used.') from None
        # Validate every row before any network request. Only public event fields
        # and internal identifiers survive; never export the other workbook columns.
        if not sessions:
            raise WorkbookValidationError('No session rows were found below the headings. Add at least one complete session.')
        try:
            return {'sessions': validate({'sessions': list(sessions.values())})['sessions']}
        except Problem:
            raise WorkbookValidationError('Session group/section identifiers conflict between rows. Keep one title and unique section per course_id.') from None
    finally:
        wb.close()


def main(argv=None):
    args = sys.argv[1:] if argv is None else argv
    try:
        if len(args) != 2:
            raise WorkbookValidationError('The reader needs an input workbook and an output JSON path. Restore the supplied workflow command.')
        payload = read_uploaded_workbook(args[0])
        Path(args[1]).write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        print(f'Workbook validated: {len(payload["sessions"])} sessions.')
        return 0
    except WorkbookValidationError as error:
        print(f'Workbook validation failed: {error}', file=sys.stderr)
    except FileNotFoundError:
        print('Workbook validation failed: catalogue/sessions.xlsx was not found, or the workflow output directory is missing. Check the filename and workflow paths.', file=sys.stderr)
    except zipfile.BadZipFile:
        print('Workbook validation failed: the file is not a readable .xlsx workbook. Open it in Excel and use Save As → Excel Workbook (.xlsx); changing the filename extension is not enough.', file=sys.stderr)
    except Exception:
        # Unexpected third-party errors may quote private workbook values.
        print('Workbook validation failed: the reader could not open or process this workbook. Save a fresh .xlsx copy without password protection and retry. No data was sent to Netlify.', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
