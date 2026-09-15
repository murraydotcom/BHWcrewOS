from pathlib import Path
from pypdf import PdfReader
import pymupdf

root=Path(__file__).resolve().parents[1]/'tmp/md-forms'
for file in root.glob('*-synthetic.pdf'):
    reader=PdfReader(file)
    fields=reader.get_fields()
    seen=set()
    for page in reader.pages:
        for ref in page.get('/Annots',[]):
            widget=ref.get_object()
            if widget.get('/Subtype')!='/Widget': continue
            field=widget.get('/Parent',widget).get_object()
            name=field.get('/T')
            assert name in fields, (file,name)
            assert name not in seen, (file,'duplicate page widget',name)
            seen.add(name)
            assert field.get('/V')==fields[name].get('/V'), (file,'value mismatch',name)
            assert widget.get('/AP',{}).get('/N'), (file,'missing appearance',name)
    assert seen==set(fields), (file,'orphaned field')
    doc=pymupdf.open(file)
    for i,page in enumerate(doc):
        page.get_pixmap(matrix=pymupdf.Matrix(1.25,1.25)).save(root/f'{file.stem}-{i}.png')
    print(f'PASS {file.name}: {len(fields)} canonical fields and appearances; {len(doc)} pages rendered')
