"""Lazy chunk loading + BM25 retrieval. No embeddings, no disk writes."""
from __future__ import annotations

import json
import random
import re
import threading
from pathlib import Path
from typing import Any

CHUNKS_PATH = Path(__file__).parent / "chunks.json"
TOPICS = ("python", "ml", "dl", "genai", "agentic")

_lock = threading.Lock()
_chunks: list[dict[str, Any]] | None = None
_bm25: Any = None
_by_topic: dict[str, list[dict[str, Any]]] = {}

_TOKEN_RE = re.compile(r"[a-z0-9_]+")


def tokenize(text: str) -> list[str]:
    return _TOKEN_RE.findall(text.lower())


def _ensure_loaded() -> None:
    """Load chunks.json and build BM25 once, thread-safe (double-checked lock)."""
    global _chunks, _bm25, _by_topic
    if _chunks is not None:
        return
    with _lock:
        if _chunks is not None:
            return
        from rank_bm25 import BM25Okapi  # lazy import

        try:
            data = json.loads(CHUNKS_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            data = []
        chunks = [
            c for c in data
            if isinstance(c, dict) and isinstance(c.get("text"), str) and c.get("topic") in TOPICS
        ]
        by_topic: dict[str, list[dict[str, Any]]] = {}
        for c in chunks:
            by_topic.setdefault(c["topic"], []).append(c)
        _by_topic = by_topic
        _bm25 = BM25Okapi([tokenize(c["text"]) for c in chunks]) if chunks else None
        _chunks = chunks  # assigned last: signals "ready"


def random_chunk(topic: str) -> dict[str, Any] | None:
    """Random chunk of a topic ('mixed' = any topic). None if nothing available."""
    _ensure_loaded()
    pool = _chunks if topic == "mixed" else _by_topic.get(topic)
    return random.choice(pool) if pool else None


def search(query: str, k: int = 4) -> list[dict[str, Any]]:
    """BM25 top-k chunks with a positive score."""
    _ensure_loaded()
    tokens = tokenize(query)
    if not tokens or _bm25 is None or not _chunks:
        return []
    scores = list(_bm25.get_scores(tokens))
    if not any(s > 0 for s in scores):
        # tiny corpora can give BM25 idf == 0; fall back to plain keyword overlap
        qset = set(tokens)
        scores = [float(len(qset & set(tokenize(c["text"])))) for c in _chunks]
    ranked = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
    return [_chunks[i] for i in ranked if scores[i] > 0]


def topic_info() -> dict[str, dict[str, Any]]:
    """Per-topic PDF availability: {topic: {"chunks": n, "pdfs": [names]}}."""
    _ensure_loaded()
    info: dict[str, dict[str, Any]] = {}
    for t in TOPICS:
        items = _by_topic.get(t, [])
        pdfs = list(dict.fromkeys(c.get("source", "notes") for c in items))
        info[t] = {"chunks": len(items), "pdfs": pdfs}
    return info


def chunk_count() -> int:
    _ensure_loaded()
    return len(_chunks or [])
