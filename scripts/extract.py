"""Untrusted supplier files are processed only in the resource-limited worker."""
import csv, json, sys, pathlib, subprocess, tempfile, zipfile
sys.stdout.reconfigure(encoding='utf-8')

source = pathlib.Path(sys.argv[1])
max_pages = int(sys.argv[2])
max_rows = int(sys.argv[3]) if len(sys.argv) > 3 else 50000
rows, warnings = [], []

IDENTIFIER_HEADERS = {
    'partnumber',
    'partno',
    'partreference',
    'partref',
    'itemcode',
    'item',
    'code',
    'sku',
    'reference',
}

def normalize_header(value):
    return ''.join(ch.lower() for ch in str(value or '') if ch.isalnum())

def format_identifier_value(value, number_format):
    if value is None:
        return ''
    if isinstance(value, bool):
        return '1' if value else '0'
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, float):
        text = str(int(value)) if value.is_integer() else str(value)
    else:
        return str(value)
    fmt = str(number_format or '')
    zero_count = len(''.join(ch for ch in fmt if ch == '0'))
    if zero_count and '.' not in fmt and text.lstrip('-').isdigit():
        digits = text.lstrip('-').zfill(zero_count)
        return ('-' if text.startswith('-') else '') + digits
    return text

def cell_text(header, cell):
    if cell.data_type == 'f':
        return 'FORMULA_REQUIRES_VALUE'
    value = cell.value
    if value == 0:
        return '0'
    if value is None:
        return ''
    if getattr(cell, 'is_date', False) or hasattr(value, 'strftime'):
        try:
            return value.strftime('%Y-%m-%d')
        except Exception:
            pass
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if normalize_header(header) in IDENTIFIER_HEADERS:
        return format_identifier_value(value, getattr(cell, 'number_format', ''))
    return str(value)

def append(values):
    if len(rows) >= max_rows:
        raise ValueError(f'Maximum {max_rows:,} rows')
    rows.append(values)

if source.suffix.lower() == '.csv':
    with source.open(encoding='utf-8-sig', newline='') as f:
        sample = f.read(4096)
        f.seek(0)
        dialect = csv.Sniffer().sniff(sample, delimiters=',;\t')
        for row in csv.DictReader(f, dialect=dialect):
            append({str(k): str(v or '') for k, v in row.items() if k is not None})
elif source.suffix.lower() == '.xlsx':
    import openpyxl
    with zipfile.ZipFile(source) as archive:
        if sum(f.file_size for f in archive.infolist()) > 100 * 1024 * 1024:
            raise ValueError('Expanded workbook exceeds 100 MB')
    book = openpyxl.load_workbook(source, read_only=True, data_only=False)
    sheet = book.worksheets[0]
    iterator = sheet.iter_rows()
    headers = [str(c.value or f'Column {i+1}') for i,c in enumerate(next(iterator))]
    if len(headers)>100 or len(set(headers))!=len(headers):
        raise ValueError('Too many or duplicate column headings')
    for cells in iterator:
        if any(c.value is not None for c in cells):
            append({headers[i]: cell_text(headers[i], c) for i,c in enumerate(cells) if i<len(headers)})
    book.close()
elif source.suffix.lower() == '.xls':
    import xlrd
    book = xlrd.open_workbook(str(source), on_demand=True)
    sheet = book.sheet_by_index(0)
    if sheet.ncols>100 or sheet.nrows>(max_rows + 1): raise ValueError(f'Maximum {max_rows:,} rows')
    headers = [str(v or f'Column {i+1}') for i,v in enumerate(sheet.row_values(0))]
    for i in range(1, sheet.nrows):
        row_vals = []
        for c in range(sheet.ncols):
            cell_type = sheet.cell_type(i, c)
            val = sheet.cell_value(i, c)
            if cell_type == xlrd.XL_CELL_DATE:
                try:
                    dt = xlrd.xldate.xldate_as_datetime(val, book.datemode)
                    row_vals.append(dt.strftime('%Y-%m-%d'))
                except Exception:
                    row_vals.append(str(val))
            elif cell_type == xlrd.XL_CELL_NUMBER:
                if isinstance(val, float) and val.is_integer():
                    row_vals.append(str(int(val)))
                else:
                    row_vals.append(str(val))
            else:
                row_vals.append(str(val if val is not None else ''))
        append(dict(zip(headers, row_vals)))
    warnings.append('Legacy XLS values may be cached formula results. Verify all prices.')
    book.release_resources()
elif source.suffix.lower() == '.pdf':
    import pdfplumber
    warnings.append('PDF extraction is low confidence. Verify every selected row against the original.')
    with pdfplumber.open(source) as pdf:
        if len(pdf.pages)>max_pages: raise ValueError('PDF page limit exceeded')
        for number,page in enumerate(pdf.pages,1):
            tables = page.extract_tables()
            if tables:
                for table in tables:
                    for values in table:
                        append({f'Column {i+1}':str(v or '') for i,v in enumerate(values)} | {'Page':str(number)})
            else:
                text = page.extract_text() or ''
                if not text.strip():
                    with tempfile.TemporaryDirectory() as tmp:
                        prefix = str(pathlib.Path(tmp)/'page')
                        subprocess.run(['pdftoppm','-f',str(number),'-l',str(number),'-scale-to','2200','-singlefile','-png',str(source),prefix],check=True,timeout=40,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
                        text = subprocess.run(['tesseract',prefix+'.png','stdout','-l','eng+ara'],check=True,timeout=45,capture_output=True,text=True).stdout
                for line in text.splitlines():
                    if line.strip(): append({'Text':line,'Page':str(number)})
else:
    raise ValueError('Unsupported format')

print(json.dumps({'rows':rows,'columns':list(rows[0]) if rows else [],'warnings':warnings},ensure_ascii=False))
