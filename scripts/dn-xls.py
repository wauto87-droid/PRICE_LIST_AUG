"""Read legacy DN workbooks without changing the uploaded file."""
import json
import sys
import xlrd

data = sys.stdin.buffer.read(10 * 1024 * 1024 + 1)
if len(data) > 10 * 1024 * 1024:
    raise ValueError('Maximum upload is 10 MB')
book = xlrd.open_workbook(file_contents=data, formatting_info=True)
if book.nsheets > 30:
    raise ValueError('Maximum 30 worksheets')
sheets = []
for sheet in book.sheets():
    if sheet.nrows > 20001 or sheet.ncols > 100:
        raise ValueError('Maximum 20,000 rows and 100 columns per sheet')
    rows = []
    for r in range(sheet.nrows):
        values = []
        for c in range(sheet.ncols):
            cell = sheet.cell(r, c)
            value = cell.value
            if cell.ctype == xlrd.XL_CELL_DATE:
                value = xlrd.xldate_as_datetime(value, book.datemode).strftime('%Y-%m-%d')
            elif cell.ctype == xlrd.XL_CELL_NUMBER:
                value = str(int(value)) if value == int(value) else str(value)
                xf = book.xf_list[cell.xf_index]
                fmt = book.format_map[xf.format_key].format_str
                if fmt and set(fmt) == {'0'}:
                    value = value.zfill(len(fmt))
            values.append(str(value))
        rows.append(values)
    sheets.append({'name': sheet.name, 'rows': rows})
print(json.dumps({'sheets': sheets}, ensure_ascii=False))
