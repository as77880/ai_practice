"""Offline ingestion: pdfs/<topic>/*.pdf -> chunks.json. Run on your laptop only.

    pip install -r requirements-ingest.txt
    python ingest.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).parent
PDF_DIR = ROOT / "pdfs"
OUT = ROOT / "chunks.json"
TOPICS = ("python", "ml", "dl", "genai", "agentic")
CHUNK_WORDS = 350
OVERLAP = 50
MIN_WORDS = 80


def extract_text(pdf: Path) -> str:
    reader = PdfReader(str(pdf))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception as exc:  # noqa: BLE001 - one bad page should not stop ingest
            print(f"  ! page skipped in {pdf.name}: {exc}")
    return re.sub(r"\s+", " ", " ".join(pages)).strip()


def split_words(text: str) -> list[str]:
    words = text.split()
    step = CHUNK_WORDS - OVERLAP
    out = []
    for start in range(0, len(words), step):
        part = words[start:start + CHUNK_WORDS]
        if len(part) >= MIN_WORDS:
            out.append(" ".join(part))
        if start + CHUNK_WORDS >= len(words):
            break
    return out


def main() -> int:
    chunks: list[dict] = []
    for topic in TOPICS:
        for pdf in sorted((PDF_DIR / topic).glob("*.pdf")):
            print(f"[{topic}] {pdf.name}")
            try:
                text = extract_text(pdf)
            except Exception as exc:  # noqa: BLE001
                print(f"  ! could not read: {exc}")
                continue
            parts = split_words(text)
            if not parts:
                print("  ! no text found (scanned PDF? try OCR first)")
            for i, part in enumerate(parts, 1):
                chunks.append({"id": f"{topic}-{pdf.stem}-{i}", "topic": topic,
                               "source": pdf.stem, "text": part})
            print(f"  -> {len(parts)} chunks")
    if not chunks:
        print("No chunks produced. Put PDFs in pdfs/<topic>/ first. chunks.json NOT changed.")
        return 1
    OUT.write_text(json.dumps(chunks, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Wrote {len(chunks)} chunks to {OUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
