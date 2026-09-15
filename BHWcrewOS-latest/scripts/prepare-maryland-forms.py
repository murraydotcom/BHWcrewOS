"""Rebuild ambiguous official widgets as uniquely named fields at export time.
Original downloads remain unchanged; templates preserve every printed page.
"""
import json
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
all_fields = {}
for stem in ['md-occ1216a-asthma', 'md-occ1216-medication', 'md-school-medication']:
    doc = pymupdf.open(ROOT / 'assets/forms' / (stem + '.pdf'))
    fields = []
    for i, page in enumerate(doc):
        for w in list(page.widgets()):
            fields.append(dict(id=f'f{len(fields)}', page=i, name=w.field_name,
                               type=w.field_type_string, rect=[round(x, 3) for x in w.rect]))
            page.delete_widget(w)
        # Source pages can share an indirect empty Annots array. Never let a
        # new widget added to one page become visible on every page.
        doc.xref_set_key(page.xref, 'Annots', '[]')
    doc.xref_set_key(doc.pdf_catalog(), 'AcroForm', 'null')
    doc.save(ROOT / 'assets/forms' / (stem + '-template.pdf'), garbage=4, deflate=True)
    if stem == 'md-occ1216a-asthma':
        fields.extend([
            dict(id='logName',page=2,name='Log Child Name',type='Text',rect=[56,140,350,153]),
            dict(id='logDob',page=2,name='Log Date of Birth',type='Text',rect=[362,140,578,153])
        ])
    all_fields[stem] = fields
(ROOT / 'assets/maryland-form-widgets.json').write_text(json.dumps(all_fields, indent=2))
