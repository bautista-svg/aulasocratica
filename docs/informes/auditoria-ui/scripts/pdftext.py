import sys, fitz
doc = fitz.open(sys.argv[1])
print("PAGES", doc.page_count)
for i, pg in enumerate(doc):
    print(f"--- page {i+1}")
    print(pg.get_text())
if len(sys.argv) > 2:
    for i, pg in enumerate(doc):
        if i >= int(sys.argv[3] if len(sys.argv) > 3 else 2): break
        pix = pg.get_pixmap(dpi=70)
        pix.save(f"{sys.argv[2]}-p{i+1}.png")
