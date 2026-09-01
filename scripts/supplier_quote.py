"""Parse supplier quotation line items from extracted PDF page text."""

import re


QUOTE_HEADER = re.compile(
    r"\barticle\s+number\b.*\bquantity\b.*\bunit\s+price\b.*\btotal\s+price\b",
    re.IGNORECASE,
)
ITEM_START = re.compile(
    r"^(?P<line>\d+)\s+(?P<article>[^\s]+)\s+"
    r"(?P<quantity>[\d,.]+)\s+(?P<unit>[A-Za-z]+)\s+"
    r"Your price per unit\s+(?P<unit_price>[\d,.]+)\s+"
    r"(?:Saudi Riyal|SAR|USD|EUR|Saudi)\s+(?P<total_price>[\d,.]+)",
    re.IGNORECASE,
)
DETAIL_LINE = re.compile(
    r"^(Price Group|Export Control Regulations|Commodity Code|Net Weight|"
    r"Country of Origin|Non-binding delivery|Total price|Day listing|CU:|"
    r"Alternative-/|Variants and short details|Page \d+ of \d+|Quote$)",
    re.IGNORECASE,
)
QUOTE_NUMBER = re.compile(r"\bQuote number\s+([^\s]+)", re.IGNORECASE)
QUOTE_DATE = re.compile(r"\bDate\s+(\d{1,2}-\d{1,2}-\d{2,4})\b")
QUOTE_METADATA_VALUE = re.compile(
    r"^(?:\d{1,2}-\d{1,2}-\d{2,4}|[A-Z]{2,}\d+)$"
)


def clean_number(value):
    return value.replace(',', '')


def clean_description(lines):
    text = ' '.join(line.strip() for line in lines if line.strip())
    text = re.sub(r'\s+', ' ', text).strip()
    return re.sub(r'\bSaudi Riyal\b|\bRiyal\b', '', text).strip(' ,')


def extract_supplier_quote_pages(pages):
    """Return normalized supplier quote rows, or None when this is not a quote table."""
    if not any(QUOTE_HEADER.search(text or '') for _, text in pages):
        return None

    quote_number = ''
    quote_date = ''
    rows = []
    current = None

    def finish_current():
        nonlocal current
        if not current:
            return
        description = clean_description(current.pop('_description'))
        if description:
            current['Description'] = description
            rows.append(current)
        current = None

    for page_number, page_text in pages:
        for raw_line in (page_text or '').splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if not quote_number:
                match = QUOTE_NUMBER.search(line)
                if match:
                    quote_number = match.group(1)
            if not quote_date:
                match = QUOTE_DATE.search(line)
                if match:
                    quote_date = match.group(1)

            item = ITEM_START.match(line)
            if item:
                finish_current()
                current = {
                    'Article number': item.group('article'),
                    'Description': '',
                    'Unit': item.group('unit'),
                    'Quoted quantity': clean_number(item.group('quantity')),
                    'Unit price': clean_number(item.group('unit_price')),
                    'Total price': clean_number(item.group('total_price')),
                    'Page': str(page_number),
                    '_description': [],
                }
                continue
            if current and line.lower().startswith('total price'):
                # The grand total begins the quote footer, not a product detail.
                finish_current()
                continue
            if (
                not current
                or QUOTE_HEADER.search(line)
                or DETAIL_LINE.match(line)
                or QUOTE_METADATA_VALUE.match(line)
            ):
                continue
            current['_description'].append(line)
    finish_current()

    if not rows:
        return None
    for row in rows:
        row['Quote number'] = quote_number
        row['Quote date'] = quote_date
    return rows
