import sys
from pypdf import PdfReader
reader = PdfReader(sys.argv[1])
embedded = set()
for page in reader.pages:
    for value in page['/Resources'].get('/Font', {}).values():
        font = value.get_object()
        candidates = [font] + [f.get_object() for f in font.get('/DescendantFonts', [])]
        for candidate in candidates:
            descriptor = candidate.get('/FontDescriptor')
            if descriptor:
                descriptor = descriptor.get_object()
                if any(key in descriptor for key in ['/FontFile','/FontFile2','/FontFile3']):
                    embedded.add(str(descriptor.get('/FontName')))
assert embedded, 'PDF must embed fonts'
text = '\n'.join(p.extract_text() for p in reader.pages)
assert '19119.10' in text, 'Expected test grand total missing'
assert len(reader.pages) >= 2, 'Multi-page test did not exercise pagination'
print('PDF QA: pages=',len(reader.pages),'embedded fonts=',len(embedded),'expected grand total present')
