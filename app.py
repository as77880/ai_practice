"""Flask app: stateless JSON API + PWA shell."""
from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import HTTPException

load_dotenv()

import agents  # noqa: E402  (light: heavy libs are imported lazily inside)
import retriever  # noqa: E402

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

TOPICS = {"python", "ml", "dl", "genai", "agentic", "mixed"}
DIFFICULTIES = {"easy", "medium", "hard"}
LIMITS = {"question": 600, "model_answer": 1500, "user_answer": 2000, "excerpt": 5000, "doubt": 500}


class BadRequest(Exception):
    pass


def error(message: str, status: int, code: str | None = None):
    body = {"error": message}
    if code:
        body["code"] = code
    return jsonify(body), status


def body_str(data: dict[str, Any], key: str, limit: int, required: bool = True) -> str:
    val = data.get(key, "")
    if not isinstance(val, str):
        raise BadRequest(f"'{key}' text hona chahiye.")
    val = val.strip()
    if required and not val:
        raise BadRequest(f"'{key}' khali hai.")
    if len(val) > limit:
        raise BadRequest(f"'{key}' bahut lamba hai (max {limit} characters).")
    return val


def json_body() -> dict[str, Any]:
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        raise BadRequest("Valid JSON body bhejo.")
    return data


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/health")
def health():
    return "ok", 200, {"Content-Type": "text/plain; charset=utf-8"}


@app.get("/sw.js")
def service_worker():
    resp = send_from_directory(app.static_folder, "sw.js", mimetype="application/javascript")
    resp.headers["Service-Worker-Allowed"] = "/"
    resp.headers["Cache-Control"] = "no-cache"
    return resp


@app.get("/api/topics")
def api_topics():
    info = retriever.topic_info()
    return jsonify({"topics": info, "total": sum(t["chunks"] for t in info.values())})


@app.get("/api/question")
def api_question():
    topic = request.args.get("topic", "mixed").lower()
    difficulty = request.args.get("difficulty", "medium").lower()
    if topic not in TOPICS:
        return error("Invalid topic.", 400)
    if difficulty not in DIFFICULTIES:
        return error("Invalid difficulty.", 400)
    return jsonify(agents.generate_question(topic, difficulty))


@app.post("/api/evaluate")
def api_evaluate():
    try:
        data = json_body()
        question = body_str(data, "question", LIMITS["question"])
        model_answer = body_str(data, "model_answer", LIMITS["model_answer"])
        user_answer = body_str(data, "user_answer", LIMITS["user_answer"])
        excerpt = body_str(data, "excerpt", LIMITS["excerpt"], required=False)
    except BadRequest as exc:
        return error(str(exc), 400)
    return jsonify(agents.evaluate_answer(question, model_answer, user_answer, excerpt))


@app.post("/api/doubt")
def api_doubt():
    try:
        question = body_str(json_body(), "question", LIMITS["doubt"])
    except BadRequest as exc:
        return error(str(exc), 400)
    return jsonify(agents.answer_doubt(question))


@app.errorhandler(agents.LLMError)
def handle_llm_error(exc: agents.LLMError):
    return error(exc.message, exc.status, exc.code)


@app.errorhandler(HTTPException)
def handle_http_error(exc: HTTPException):
    return error(exc.name, exc.code or 500)


@app.errorhandler(Exception)
def handle_unexpected(exc: Exception):
    app.logger.exception("Unhandled error: %s", exc)
    return error("Kuch gadbad ho gayi. Dobara try karo.", 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=False)
