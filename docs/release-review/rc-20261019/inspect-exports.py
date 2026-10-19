"""Inspects the candidate's export files: PDF pages, sizes, fonts (embedded or not), extractable text,
outline/bookmarks and links; PPTX editable text runs, speaker notes, native charts, pictures and font
references/embedding. Output: exports/inspection.json. Usage: python -I docs/release-review/rc-20261019/inspect-exports.py"""
import json, re, sys, zipfile, os
import fitz
OUT = os.path.join("docs", "release-review", "rc-20261019", "exports")
report = {}
for name in sorted(os.listdir(OUT)):
    path = os.path.join(OUT, name)
    if name.endswith(".pdf"):
        doc = fitz.open(path)
        fonts = {}
        for page in doc:
            for f in page.get_fonts(full=True):
                xref, ext, ftype, basefont = f[0], f[1], f[2], f[3]
                fonts[basefont] = {"type": ftype, "embedded": ext not in ("", "n/a")}
        sizes = sorted({(round(p.rect.width), round(p.rect.height)) for p in doc})
        words = sum(len(p.get_text("words")) for p in doc)
        empty = [i + 1 for i, p in enumerate(doc) if not p.get_text().strip() and not p.get_images()]
        report[name] = {"pages": doc.page_count, "pageSizesPt": sizes, "fonts": fonts, "allFontsEmbedded": all(v["embedded"] for v in fonts.values()),
                        "words": words, "pagesWithoutTextOrImages": empty, "outlineEntries": len(doc.get_toc()), "links": sum(len(p.get_links()) for p in doc),
                        "firstPageText": doc[0].get_text()[:160]}
    elif name.endswith(".pptx"):
        z = zipfile.ZipFile(path)
        names = z.namelist()
        slides = sorted([n for n in names if re.match(r"ppt/slides/slide\d+\.xml$", n)], key=lambda n: int(re.findall(r"\d+", n)[-1]))
        notes = [n for n in names if re.match(r"ppt/notesSlides/notesSlide\d+\.xml$", n)]
        charts = [n for n in names if re.match(r"ppt/charts/chart\d+\.xml$", n)]
        media = [n for n in names if n.startswith("ppt/media/")]
        per_slide = []
        typefaces = set()
        for s in slides:
            xml = z.read(s).decode("utf8")
            runs = re.findall(r"<a:t>([^<]*)</a:t>", xml)
            typefaces.update(re.findall(r'typeface="([^"]+)"', xml))
            per_slide.append({"slide": s.split("/")[-1], "textRuns": len(runs), "chars": sum(len(r) for r in runs), "pictures": xml.count("<p:pic>"), "graphicFrames": xml.count("<p:graphicFrame>")})
        notes_text = [sum(len(t) for t in re.findall(r"<a:t>([^<]*)</a:t>", z.read(n).decode("utf8"))) for n in notes]
        pres = z.read("ppt/presentation.xml").decode("utf8")
        report[name] = {"slides": len(slides), "slidesWithEditableText": sum(1 for p in per_slide if p["textRuns"] > 0), "notesSlides": len(notes), "notesWithText": sum(1 for n in notes_text if n > 0),
                        "nativeCharts": len(charts), "media": len(media), "typefaces": sorted(typefaces), "embeddedFontList": "embeddedFontLst" in pres, "fontParts": [n for n in names if n.startswith("ppt/fonts/")],
                        "perSlide": per_slide}
json.dump(report, open(os.path.join(OUT, "inspection.json"), "w"), indent=2)
for k, v in report.items():
    summary = {kk: vv for kk, vv in v.items() if kk not in ("perSlide", "fonts", "firstPageText")}
    print(k, json.dumps(summary))
    if "fonts" in v: print("   fonts:", {f: ("embedded" if d["embedded"] else "NOT embedded") for f, d in v["fonts"].items()})
