"""Run: python -m unittest discover -s tests -v   (uses a mock LLM, no API key needed)"""
import json
import os
import sys
import unittest
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import tempfile  # noqa: E402

import agents  # noqa: E402
import app as app_module  # noqa: E402
import retriever  # noqa: E402

PY = "Python list tuple mutable ordered collection items append remove change creation memory " * 3
ML = "model training data generalization noise penalty validation regularization complexity unseen " * 3
FIXTURE = [
    {"id": "python-a-1", "topic": "python", "source": "python-notes", "text": "Python lists vs tuples. " + PY},
    {"id": "ml-a-1", "topic": "ml", "source": "ml-notes", "text": "Overfitting and regularization. " + ML},
]


def use_chunks(chunks):
    """Point the retriever at a temp chunks file and reset its lazy state."""
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(chunks, f)
    f.close()
    retriever.CHUNKS_PATH = type(retriever.CHUNKS_PATH)(f.name)
    retriever._chunks, retriever._bm25, retriever._by_topic = None, None, {}


class RateLimitError(Exception):
    status_code = 429


class FakeLLM:
    def __init__(self):
        self.calls = 0
        self.fail_first_json = False
        self.raise_exc = None

    def invoke(self, messages):
        self.calls += 1
        if self.raise_exc:
            raise self.raise_exc
        text = messages[-1][1]
        if self.fail_first_json and self.calls == 1:
            return SimpleNamespace(content="Sorry, here you go without JSON")
        if "practice question (mcq)" in text:
            return SimpleNamespace(content='Sure!\n```json\n{"question":"What is X?","options":["a","b","c","d"],"answer_index":2,"explanation":"Ye isliye."}\n```')
        if "practice question (short)" in text:
            return SimpleNamespace(content='{"question":"Explain X","model_answer":"X is Y.","explanation":"Simple hai."}')
        if "Evaluate" in text:
            return SimpleNamespace(content='{"score": 7, "verdict": "Partially correct", "feedback": "Achha.", "missing_points": ["detail"]}')
        if "search keywords" in text:
            return SimpleNamespace(content="python list tuple mutable")
        return SimpleNamespace(content="List mutable hoti hai [Sample notes: Python lists vs tuples].")


class AppTests(unittest.TestCase):
    def setUp(self):
        use_chunks(FIXTURE)  # only python + ml have PDFs
        self.llm = FakeLLM()
        agents._llm = self.llm
        self.c = app_module.app.test_client()

    def test_basic_routes(self):
        self.assertEqual(self.c.get("/health").data, b"ok")
        self.assertEqual(self.c.get("/").status_code, 200)
        sw = self.c.get("/sw.js")
        self.assertEqual(sw.status_code, 200)
        self.assertEqual(sw.headers["Service-Worker-Allowed"], "/")
        self.assertEqual(self.c.get("/static/manifest.json").status_code, 200)
        self.assertEqual(self.c.get("/nope").get_json()["error"], "Not Found")

    def test_question_all_topics(self):
        for topic in ["python", "ml", "mixed"]:
            for _ in range(4):
                r = self.c.get(f"/api/question?topic={topic}&difficulty=easy")
                self.assertEqual(r.status_code, 200, r.data)
                d = r.get_json()
                self.assertIn(d["type"], ("mcq", "short"))
                self.assertTrue(d["source"] and d["excerpt"])
                if d["type"] == "mcq":
                    self.assertEqual(len(d["options"]), 4)
                    self.assertEqual(d["answer_index"], 2)

    def test_no_pdf_topic_is_refused_without_calling_llm(self):
        for topic in ["dl", "genai", "agentic"]:
            r = self.c.get(f"/api/question?topic={topic}")
            self.assertEqual(r.status_code, 404)
            d = r.get_json()
            self.assertEqual(d["code"], "no_pdf")
            self.assertIn("PDF nahi hai", d["error"])
        self.assertEqual(self.llm.calls, 0)

    def test_no_pdfs_at_all(self):
        use_chunks([])
        for topic in ["mixed", "python"]:
            r = self.c.get(f"/api/question?topic={topic}")
            self.assertEqual((r.status_code, r.get_json()["code"]), (404, "no_pdf"))
        self.assertEqual(self.c.get("/api/topics").get_json()["total"], 0)

    def test_topics_endpoint(self):
        d = self.c.get("/api/topics").get_json()
        self.assertEqual(d["total"], 2)
        self.assertEqual(d["topics"]["python"]["pdfs"], ["python-notes"])
        self.assertEqual(d["topics"]["dl"], {"chunks": 0, "pdfs": []})

    def test_question_validation(self):
        self.assertEqual(self.c.get("/api/question?topic=bad").status_code, 400)
        self.assertEqual(self.c.get("/api/question?difficulty=insane").status_code, 400)

    def test_json_retry(self):
        self.llm.fail_first_json = True
        r = self.c.get("/api/question?topic=ml&difficulty=medium")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.llm.calls, 2)

    def test_json_failure_is_friendly(self):
        self.llm.invoke = lambda m: SimpleNamespace(content="no json at all")
        r = self.c.get("/api/question?topic=ml")
        self.assertEqual(r.status_code, 502)
        self.assertIn("error", r.get_json())

    def test_rate_limit_and_timeout(self):
        self.llm.raise_exc = RateLimitError("x")
        self.assertEqual(self.c.get("/api/question").status_code, 429)
        self.llm.raise_exc = type("APITimeoutError", (Exception,), {})("t")
        self.assertEqual(self.c.get("/api/question").status_code, 504)

    def test_missing_key(self):
        agents._llm = None
        for k in ("OPENROUTER_API_KEY", "OPENROUTER_MODEL"):
            os.environ.pop(k, None)
        r = self.c.get("/api/question")
        self.assertEqual(r.status_code, 503)

    def test_evaluate(self):
        body = {"question": "Q", "model_answer": "M", "user_answer": "U", "excerpt": "E"}
        r = self.c.post("/api/evaluate", json=body)
        self.assertEqual(r.status_code, 200)
        d = r.get_json()
        self.assertEqual((d["score"], d["missing_points"]), (7, ["detail"]))
        self.assertEqual(self.c.post("/api/evaluate", json={**body, "user_answer": ""}).status_code, 400)
        self.assertEqual(self.c.post("/api/evaluate", json={**body, "user_answer": "x" * 2001}).status_code, 400)
        self.assertEqual(self.c.post("/api/evaluate", data="notjson").status_code, 400)
        self.assertEqual(self.c.post("/api/evaluate", json={**body, "question": 5}).status_code, 400)

    def test_doubt_graph(self):
        r = self.c.post("/api/doubt", json={"question": "list aur tuple me kya fark hai?"})
        self.assertEqual(r.status_code, 200, r.data)
        d = r.get_json()
        self.assertTrue(d["answer"])
        self.assertIn("python-notes", d["sources"])
        self.assertEqual(self.llm.calls, 2)  # rewrite + answer
        self.assertEqual(self.c.post("/api/doubt", json={"question": ""}).status_code, 400)
        self.assertEqual(self.c.post("/api/doubt", json={"question": "x" * 501}).status_code, 400)

    def test_extract_json(self):
        self.assertEqual(agents.extract_json('x {"a": "}{"} y'), {"a": "}{"})
        self.assertIsNone(agents.extract_json("nothing"))
        self.assertEqual(agents.extract_json('{bad} {"ok": 1}'), {"ok": 1})


if __name__ == "__main__":
    unittest.main()
