"""Inspect localhost-generated PDF fixtures; run after check-pdf-layout.cjs."""
from pathlib import Path
import pdfplumber
from PIL import Image, ImageDraw

root = Path("../pdf-layout-checks")
for name, count in [("editorial-book", 6), ("dark-book", 6), ("native-presentation", 3)]:
    with pdfplumber.open(root / (name + ".pdf")) as document:
        assert len(document.pages) == count, (name, "unexpected page count")
        text = " ".join(" ".join((page.extract_text() or "").split()) for page in document.pages)
        for number, page in enumerate(document.pages, 1):
            assert page.chars, (name, number, "empty page")
            assert all(char["x0"] >= -1 and char["x1"] <= page.width + 1 and char["top"] >= -1 and char["bottom"] <= page.height + 1 for char in page.chars), (name, number, "text outside page")
            if "book" in name:
                assert (f"{number} / {count}" in (page.extract_text() or "")) == (number > 1), (name, number, "wrong folio")
        if "book" in name:
            assert text.count("A strong client project starts with listening.") == 12, (name, "missing supplied paragraph")
            quote_page = next(page for page in document.pages if "Good work makes the next decision easier." in (page.extract_text() or ""))
            assert "7. A strong client project" in quote_page.extract_text(), (name, "isolated closing quote")
            assert "Final checkpoint:" in text
        else:
            assert "Ready for a real conversation" in text
            assert "Confirm the brief. Resolve the open questions. Choose the next action." in text
        print("PASS", name, count, "pages; source text retained; page bounds and numbering checked")

files = list(root.glob("editorial-*.png")) + list(root.glob("dark-*.png")) + list(root.glob("slides-*.png"))
sheet = Image.new("RGB", (1200, 455 * ((len(files) + 3) // 4)), "#dddddd")
draw = ImageDraw.Draw(sheet)
for index, file in enumerate(files):
    image = Image.open(file).convert("RGB")
    image.thumbnail((284, 420))
    x, y = (index % 4) * 300 + 8, (index // 4) * 455 + 25
    sheet.paste(image, (x, y))
    draw.text((x, y - 19), file.name, fill="black")
sheet.save(root / "contact-sheet.jpg")
