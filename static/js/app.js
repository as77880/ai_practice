(function () {
  "use strict";

  // ---------- safe storage (works even if localStorage is blocked) ----------
  const KEY = "aiTutor.v1";
  let memoryStore = null;
  const emptyStats = () => ({ topics: {}, total: 0, correct: 0, streak: { last: "", count: 0 }, mistakes: [] });
  function loadStats() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) { const s = JSON.parse(raw); if (s && typeof s === "object") return Object.assign(emptyStats(), s); }
    } catch (e) { /* blocked or corrupt */ }
    return memoryStore || emptyStats();
  }
  function saveStats(s) {
    memoryStore = s;
    try { window.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  // ---------- helpers (textContent only: no innerHTML) ----------
  const $ = (id) => document.getElementById(id);
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      if (k === "class") el.className = props[k];
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), props[k]);
      else el.setAttribute(k, props[k]);
    }
    for (const kid of kids) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const NS = "http://www.w3.org/2000/svg";
  function icon(id, size) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", size); svg.setAttribute("height", size);
    const use = document.createElementNS(NS, "use"); use.setAttribute("href", "#" + id);
    svg.append(use); return svg;
  }
  const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const buzz = (ms) => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } };

  let toastTimer = 0;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  async function api(url, opts) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 100000);
    try {
      const res = await fetch(url, Object.assign({ signal: ctrl.signal }, opts));
      let data = null;
      try { data = await res.json(); } catch (e) { /* non-JSON */ }
      if (!res.ok) {
        const err = new Error((data && data.error) || "Server error (" + res.status + ")");
        err.code = data && data.code; throw err;
      }
      return data;
    } catch (e) {
      if (e.name === "AbortError") throw new Error("Request time out ho gaya. Retry karo.");
      if (e instanceof TypeError) throw new Error("Internet ya server se connection nahi ho paaya.");
      throw e;
    } finally { clearTimeout(timer); }
  }
  const post = (url, body) => api(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  document.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".ripple");
    if (!t || t.disabled) return;
    const r = t.getBoundingClientRect(), size = Math.max(r.width, r.height) * 2;
    const dot = h("span", { class: "ripple-dot" });
    dot.style.cssText = "width:" + size + "px;height:" + size + "px;left:" + (e.clientX - r.left - size / 2) + "px;top:" + (e.clientY - r.top - size / 2) + "px";
    t.append(dot); setTimeout(() => dot.remove(), 600);
  });

  // ---------- tabs ----------
  const TAB_TITLES = { practice: "Practice", doubt: "Ask a doubt", progress: "Your progress" };
  function showTab(name) {
    Object.keys(TAB_TITLES).forEach((t) => { $("tab-" + t).hidden = t !== name; });
    document.querySelectorAll(".nav-btn").forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    $("barTitle").textContent = TAB_TITLES[name];
    $("main").scrollTop = 0;
    if (name === "progress") renderProgress();
    if (name === "practice" && !inSession) refreshHome();
  }
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

  // ---------- topics ----------
  const TOPICS = [["python", "Python", "Py"], ["ml", "Machine Learning", "ML"], ["dl", "Deep Learning", "DL"], ["genai", "GenAI", "Ai"], ["agentic", "Agentic AI", "Ag"]];
  const NAME = { mixed: "Mixed", python: "Python", ml: "ML", dl: "DL", genai: "GenAI", agentic: "Agentic AI" };
  const LONG = { mixed: "Mixed", python: "Python", ml: "Machine Learning", dl: "Deep Learning", genai: "GenAI", agentic: "Agentic AI" };
  const DIFFS = [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]];
  let info = null;          // {topic: {chunks, pdfs[]}} from /api/topics, null if unknown
  let difficulty = "medium";
  let topic = "mixed";
  let inSession = false;
  let busy = false;
  let session = { asked: 0, correct: 0 };
  const area = () => $("practiceArea");

  async function refreshHome() {
    renderHome();
    try { info = (await api("/api/topics")).topics; } catch (e) { info = null; }
    if (!inSession) renderHome();
  }
  const pdfCount = (t) => (info && info[t] ? info[t].pdfs.length : null);
  const totalChunks = () => (info ? Object.values(info).reduce((n, t) => n + t.chunks, 0) : null);

  function renderHome() {
    const root = h("div", { class: "stack" });
    const banner = h("div", { class: "banner" },
      h("h2", { class: "hero" }, "What do you want to practice?"),
      h("p", { class: "sub" }, "Questions are made only from your own PDF notes."));
    const seg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Difficulty" });
    DIFFS.forEach(([v, label]) => {
      const b = h("button", { type: "button", role: "radio", "aria-checked": String(v === difficulty) }, label);
      b.addEventListener("click", () => { difficulty = v; seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b))); });
      seg.append(b);
    });
    banner.append(seg);
    root.append(banner);
    if (totalChunks() === 0) root.append(noPdfCard("Abhi koi PDF nahi hai", "App ko tumhare notes chahiye. Pehle PDF add karo."));
    const grid = h("div", { class: "grid" });
    TOPICS.forEach(([key, long, abbr]) => {
      const n = pdfCount(key);
      const off = n === 0;
      const meta = n === null ? "Tap to start" : off ? "No PDF yet" : n + (n === 1 ? " PDF ready" : " PDFs ready");
      const c = h("button", { class: "tcard ripple t-" + key + (off ? " off" : ""), type: "button", "aria-disabled": String(off) },
        h("span", { class: "tile" }, abbr), h("span", null, h("div", { class: "tname" }, long), h("div", { class: "tmeta" }, meta)));
      c.addEventListener("click", () => {
        if (off) { toast(NAME[key] + " ka PDF nahi hai. Is topic ka PDF add karo."); return; }
        startSession(key);
      });
      grid.append(c);
    });
    const mOff = totalChunks() === 0;
    const withPdf = info ? TOPICS.filter(([k]) => info[k].chunks > 0).length : null;
    const mixed = h("button", { class: "tcard ripple t-mixed" + (mOff ? " off" : ""), type: "button", "aria-disabled": String(mOff) },
      h("span", { class: "tile" }, "All"), h("span", null, h("div", { class: "tname" }, "Mixed"),
        h("div", { class: "tmeta" }, mOff ? "No PDF yet" : withPdf === null ? "Every topic that has a PDF" : withPdf + " of 5 topics have PDFs")));
    mixed.addEventListener("click", () => { if (mOff) { toast("Abhi kisi topic ka PDF nahi hai."); return; } startSession("mixed"); });
    grid.append(mixed);
    root.append(grid);
    area().replaceChildren(root);
  }

  function noPdfCard(title, text) {
    return h("div", { class: "card notice" },
      h("span", { class: "bigicon" }, icon("i-doc", 28)), h("h3", null, title), h("p", null, text),
      h("ol", null, h("li", null, "PDF ko pdfs/<topic>/ folder me rakho"), h("li", null, "python ingest.py chalao"), h("li", null, "chunks.json commit karke deploy karo")));
  }

  // ---------- session ----------
  function startSession(t) {
    topic = t; inSession = true; session = { asked: 0, correct: 0 };
    const back = h("button", { class: "btn icon ripple", type: "button", "aria-label": "Back to topics", onclick: leaveSession }, icon("i-back", 24));
    const score = h("div", { class: "score", id: "score" }, "0/0");
    const title = h("div", { class: "stitle" }, LONG[t], h("small", null, "Question 1 | " + difficulty));
    title.id = "stitle";
    area().replaceChildren(h("div", { class: "sbar" }, back, title, score), h("div", { id: "qBody", class: "qwrap" }));
    $("main").scrollTop = 0;
    loadQuestion();
  }
  function leaveSession() { inSession = false; busy = false; refreshHome(); }
  function updateBar() {
    const s = $("score"), t = $("stitle");
    if (s) s.textContent = session.correct + "/" + session.asked;
    if (t) t.lastChild.textContent = "Question " + (session.asked + 1) + " | " + difficulty;
  }

  function skeleton() {
    return h("div", { class: "card", "aria-busy": "true" }, h("div", { class: "skeleton", style: "width:35%" }), h("div", { class: "skeleton" }),
      h("div", { class: "skeleton", style: "width:80%" }), h("div", { class: "skeleton", style: "height:52px" }), h("div", { class: "skeleton", style: "height:52px" }));
  }

  async function loadQuestion() {
    if (busy) return;
    busy = true;
    const body = $("qBody"); if (!body) { busy = false; return; }
    body.replaceChildren(skeleton());
    updateBar(); $("main").scrollTop = 0;
    try {
      const q = await api("/api/question?topic=" + encodeURIComponent(topic) + "&difficulty=" + encodeURIComponent(difficulty));
      if (!inSession) return;
      renderQuestion(body, q);
    } catch (e) {
      if (!inSession) return;
      if (e.code === "no_pdf") {
        body.replaceChildren(noPdfCard(e.message, "Sirf PDF se hi questions bante hain, isliye is topic me question nahi aayega."),
          h("button", { class: "btn primary block ripple", type: "button", onclick: leaveSession }, "Choose another topic"));
      } else {
        body.replaceChildren(h("div", { class: "card error", role: "alert" }, h("p", null, e.message)),
          h("div", { class: "row2" }, h("button", { class: "btn primary ripple", type: "button", onclick: () => { busy = false; loadQuestion(); } }, "Retry"),
            h("button", { class: "btn ripple", type: "button", onclick: leaveSession }, "Topics")));
      }
    } finally { busy = false; }
  }

  function pdfChip(q) { return h("span", { class: "pdfchip" }, icon("i-doc", 16), q.source); }
  function dock(...btns) { return h("div", { class: "dock" }, ...btns); }
  const nextBtn = () => h("button", { class: "btn primary block ripple", type: "button", onclick: loadQuestion }, "Next question");

  function renderQuestion(body, q) {
    const card = h("div", { class: "card t-" + q.topic },
      h("div", { class: "meta" }, (q.type === "mcq" ? "Multiple choice" : "Short answer") + " | " + (LONG[q.topic] || q.topic)),
      h("p", { class: "q-text" }, q.question));
    const skip = h("button", { class: "btn ghost ripple", type: "button", onclick: loadQuestion }, "Skip");
    body.replaceChildren(card);
    if (q.type === "mcq") {
      const opts = h("div", { class: "opts" });
      const buttons = q.options.map((text, i) => {
        const b = h("button", { class: "opt ripple", type: "button" }, h("span", { class: "letter" }, "ABCD"[i]), h("span", null, text));
        b.addEventListener("click", () => {
          buttons.forEach((x, j) => { x.disabled = true; if (j === q.answer_index) x.classList.add("correct"); });
          const ok = i === q.answer_index;
          if (!ok) b.classList.add("wrong");
          buzz(ok ? 15 : [20, 40, 20]);
          finish(q, ok, q.options[q.answer_index], text);
          skip.hidden = true;
          body.append(resultCard({ ok, title: ok ? "Correct!" : "Not quite", q }), dock(nextBtn()));
          body.lastChild.previousSibling.scrollIntoView({ block: "nearest" });
        });
        return b;
      });
      buttons.forEach((b) => opts.append(b));
      card.append(opts);
      body.append(h("div", { class: "row2" }, skip));
    } else {
      const ta = h("textarea", { placeholder: "Write your answer in your own words", maxlength: "2000", "aria-label": "Your answer" });
      const cnt = h("div", { class: "count" }, "0/2000");
      const submit = h("button", { class: "btn primary block ripple", type: "button", disabled: "" }, "Check my answer");
      ta.addEventListener("input", () => { cnt.textContent = ta.value.length + "/2000"; submit.disabled = !ta.value.trim(); });
      submit.addEventListener("click", async () => {
        const text = ta.value.trim(); if (!text) return;
        submit.disabled = true; ta.disabled = true; skip.disabled = true;
        const wait = skeleton(); wait.firstChild.style.width = "50%"; body.append(wait);
        try {
          const r = await post("/api/evaluate", { question: q.question, model_answer: q.model_answer, user_answer: text, excerpt: q.excerpt });
          wait.remove();
          const ok = r.score >= 6;
          finish(q, ok, q.model_answer, text);
          body.append(resultCard({ ok, mid: r.score >= 4 && r.score < 6, title: r.verdict, sub: "Score " + r.score + "/10", q, r }), dock(nextBtn()));
          submit.hidden = true; skip.hidden = true;
          body.lastChild.previousSibling.scrollIntoView({ block: "nearest" });
        } catch (err) {
          wait.remove(); submit.disabled = false; ta.disabled = false; skip.disabled = false;
          toast(err.message);
        }
      });
      card.append(ta, cnt);
      body.append(submit, h("div", { class: "row2" }, skip));
    }
  }

  function resultCard(o) {
    const q = o.q;
    const cls = o.ok ? "good" : (o.mid ? "mid" : "bad");
    const card = h("div", { class: "card result " + cls, "aria-live": "polite" },
      h("div", { class: "verdict" }, h("span", { class: "badge" }, icon(o.ok ? "i-check" : "i-x", 24)),
        h("div", null, h("h3", null, o.title), o.sub ? h("small", null, o.sub) : null)));
    if (o.r) {
      card.append(h("p", null, o.r.feedback));
      if (o.r.missing_points && o.r.missing_points.length) {
        card.append(h("div", { class: "label" }, "What you missed"), h("ul", null, ...o.r.missing_points.map((m) => h("li", null, m))));
      }
      card.append(h("div", { class: "label" }, "Model answer"), h("p", null, q.model_answer));
    }
    card.append(h("div", { class: "label" }, "Explanation"), h("p", null, q.explanation), pdfChip(q));
    return card;
  }

  function finish(q, ok, correctText, yourText) {
    session.asked += 1; if (ok) session.correct += 1;
    const t = $("score"); if (t) t.textContent = session.correct + "/" + session.asked;
    const nxt = $("stitle"); if (nxt) nxt.lastChild.textContent = "Question " + (session.asked) + " answered";
    record(q, ok, correctText, yourText, q.explanation);
  }

  // ---------- stats ----------
  function record(q, ok, correctText, yourText, explanation) {
    const s = loadStats();
    const t = s.topics[q.topic] || { a: 0, c: 0};
    t.a += 1; if (ok) t.c += 1;
    s.topics[q.topic] = t; s.total += 1; if (ok) s.correct += 1;
    const now = new Date(), today = ymd(now), yest = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    if (s.streak.last !== today) { s.streak.count = s.streak.last === yest ? s.streak.count + 1 : 1; s.streak.last = today; }
    if (!ok) {
      s.mistakes.unshift({ ts: Date.now(), topic: q.topic, question: q.question, correct: correctText, yours: yourText, explanation: explanation });
      s.mistakes = s.mistakes.slice(0, 50);
    }
    saveStats(s);
  }

  function ring(pct) {
    const wrap = h("div", { class: "ring", role: "img", "aria-label": pct + " percent accuracy" });
    const svg = document.createElementNS(NS, "svg"); svg.setAttribute("width", 112); svg.setAttribute("height", 112); svg.setAttribute("viewBox", "0 0 112 112");
    const C = 2 * Math.PI * 46;
    const defs = document.createElementNS(NS, "defs"), grad = document.createElementNS(NS, "linearGradient");
    grad.setAttribute("id", "ringGrad"); grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "1"); grad.setAttribute("y2", "1");
    [["0", "var(--primary)"], ["1", "var(--primary-2)"]].forEach(([o, col]) => {
      const st = document.createElementNS(NS, "stop"); st.setAttribute("offset", o); st.setAttribute("style", "stop-color:" + col); grad.append(st);
    });
    defs.append(grad); svg.append(defs);
    [["var(--surface-2)", 0], ["url(#ringGrad)", C * (1 - pct / 100)]].forEach(([stroke, off]) => {
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", 56); c.setAttribute("cy", 56); c.setAttribute("r", 46); c.setAttribute("fill", "none");
      c.setAttribute("stroke", stroke); c.setAttribute("stroke-width", 12); c.setAttribute("stroke-linecap", "round");
      c.setAttribute("stroke-dasharray", C); c.setAttribute("stroke-dashoffset", off); svg.append(c);
    });
    wrap.append(svg, h("div", { class: "num" }, pct + "%"));
    return wrap;
  }

  function renderProgress() {
    const s = loadStats(), root = h("div", { class: "pgrid" });
    const left = h("div", { class: "stack" }), right = h("div", { class: "stack" });
    const today = ymd(new Date()), y = new Date(); y.setDate(y.getDate() - 1);
    const streak = (s.streak.last === today || s.streak.last === ymd(y)) ? s.streak.count : 0;
    const acc = s.total ? Math.round((s.correct / s.total) * 100) : 0;
    left.append(h("div", { class: "top" }, ring(acc), h("div", { class: "mini" },
      h("div", { class: "stat" }, h("span", null, "Attempted"), h("b", null, s.total)),
      h("div", { class: "stat" }, h("span", null, "Day streak"), h("b", null, icon("i-flame", 20), " " + streak)))));
    if (!s.total) left.append(h("p", { class: "empty" }, "Answer a few questions and your progress will show up here."));
    left.append(h("h2", null, "Accuracy by topic"));
    const bars = h("div", { class: "card" });
    TOPICS.forEach(([k, , abbr]) => {
      const t = s.topics[k] || { a: 0, c: 0 }, pct = t.a ? Math.round((t.c / t.a) * 100) : 0;
      const fill = h("span"); fill.style.width = pct + "%";
      bars.append(h("div", { class: "bar-row t-" + k }, h("span", null, NAME[k]), h("div", { class: "bar" }, fill), h("span", null, t.a ? pct + "%" : "-")));
    });
    left.append(bars);
    right.append(h("h2", null, "Mistake notebook (" + s.mistakes.length + ")"));
    if (!s.mistakes.length) right.append(h("p", { class: "empty" }, "No mistakes yet. Wrong answers are saved here for revision."));
    s.mistakes.forEach((m) => right.append(h("details", { class: "mistake" },
      h("summary", null, m.question),
      h("div", { class: "body" }, h("div", { class: "meta" }, (NAME[m.topic] || m.topic) + " | " + new Date(m.ts).toLocaleDateString()),
        h("div", { class: "label" }, "Your answer"), h("p", null, m.yours),
        h("div", { class: "label" }, "Correct answer"), h("p", null, m.correct),
        h("div", { class: "label" }, "Why"), h("p", null, m.explanation)))));
    if (s.total) left.append(h("button", { class: "btn ripple", type: "button", onclick: () => {
      if (window.confirm("Saara progress delete karna hai?")) { saveStats(emptyStats()); renderProgress(); }
    } }, "Reset progress"));
    root.append(left, right);
    $("progressArea").replaceChildren(root);
  }

  // ---------- doubt ----------
  const chat = $("chat");
  const SUGGESTIONS = ["Overfitting kya hota hai?", "Backpropagation simple me samjhao", "RAG kaise kaam karta hai?"];
  function chatEmpty() {
    chat.replaceChildren(h("div", { class: "hint" }, h("p", { class: "sub" }, "Apne PDF notes se jawab milega. Hinglish ya English me poocho."),
      ...SUGGESTIONS.map((t) => h("button", { class: "sugg ripple", type: "button", onclick: () => sendDoubt(t) }, t))));
  }
  let doubtBusy = false;
  async function sendDoubt(text) {
    const input = $("doubtInput");
    const q = (typeof text === "string" ? text : input.value).trim();
    if (!q || doubtBusy) return;
    doubtBusy = true; input.value = "";
    const hint = chat.querySelector(".hint"); if (hint) hint.remove();
    chat.append(h("div", { class: "bubble" }, q));
    const wait = h("div", { class: "card answer" }, h("div", { class: "skeleton" }), h("div", { class: "skeleton", style: "width:60%" }));
    chat.append(wait); wait.scrollIntoView({ block: "end" });
    try {
      const r = await post("/api/doubt", { question: q });
      const card = h("div", { class: "card answer" }, h("p", null, r.answer));
      if (r.sources && r.sources.length) {
        const row = h("div", null, h("div", { class: "label" }, "From your PDFs"));
        r.sources.forEach((s) => row.append(h("span", { class: "src" }, s)));
        card.append(row);
      }
      wait.replaceWith(card);
    } catch (e) {
      wait.replaceWith(h("div", { class: "card answer error", role: "alert" }, h("p", null, e.message)));
    } finally { doubtBusy = false; chat.lastElementChild && chat.lastElementChild.scrollIntoView({ block: "end" }); }
  }
  $("doubtSend").addEventListener("click", () => sendDoubt());
  $("doubtInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); sendDoubt(); } });

  // ---------- theme (light / dark) ----------
  const THEME_KEY = "aiTutor.theme";
  const THEME_COLORS = { light: "#f4f6ff", dark: "#0b0e1f" };
  function applyTheme(t, persist) {
    document.documentElement.setAttribute("data-theme", t);
    const meta = $("metaTheme"); if (meta) meta.setAttribute("content", THEME_COLORS[t]);
    const btn = $("themeBtn"); if (btn) btn.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
    if (persist) { try { window.localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ } }
  }
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light", false);
  $("themeBtn").addEventListener("click", () => {
    applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark", true);
  });
  // follow the OS setting until the user picks one manually
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
      let saved = null; try { saved = window.localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
      if (!saved) applyTheme(e.matches ? "dark" : "light", false);
    });
  } catch (e) { /* old browsers */ }

  // ---------- init ----------
  chatEmpty();
  refreshHome();
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {}); });
  }
})();
