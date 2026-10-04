# AI Practice Tutor (PWA)

Apne PDF notes se Python, ML, DL, GenAI aur Agentic AI ke practice questions banane wala mobile-first app.
**Questions sirf tumhare PDF se aate hain.** Jis topic ka PDF nahi hota, uska card "No PDF yet" dikhata hai aur question nahi banta.
RAG (BM25) + LangGraph + OpenRouter. Koi login nahi, progress browser ke localStorage me save hota hai.

## 1. Local setup
```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # Windows: copy .env.example .env
```
`.env` kholo aur apni values daalo:
- `OPENROUTER_API_KEY` = openrouter.ai se banayi hui key
- `OPENROUTER_MODEL` = koi bhi model id (e.g. `something/model-name:free`). Code me model hardcoded nahi hai.

## 2. PDFs ingest karna (sirf laptop par)
1. PDFs ko topic folder me rakho: `pdfs/python`, `pdfs/ml`, `pdfs/dl`, `pdfs/genai`, `pdfs/agentic`.
2. Chalao:
```bash
pip install -r requirements-ingest.txt
python ingest.py
```
3. `chunks.json` ban jayegi (~350 words ke chunks, 50 words overlap). Is file ko commit karo. `pdfs/` git me nahi jaati.
   Scanned (image) PDF me text nahi milta, pehle OCR kar lo.
`chunks.json` shuru me khali (`[]`) hai, isliye PDF ingest karne se pehle app "PDF nahi hai" dikhayega. Jo topic folder khali hoga, wahan question nahi aayega.

## 3. Local run + phone par test
```bash
gunicorn app:app --workers 1 --threads 4 --timeout 120 -b 0.0.0.0:5000
# ya: python app.py
```
Laptop ka local IP dekho (`ipconfig` / `ifconfig`), phone ko same Wi-Fi par rakho aur Chrome me `http://<laptop-ip>:5000` kholo.
(Service worker / "Add to Home Screen" ke liye HTTPS chahiye, wo Render par milega.)

Tests (mock LLM, API key nahi chahiye): `python -m unittest discover -s tests -v`

## 4. Render par deploy
1. Code ko **PRIVATE** GitHub repo me push karo (PDF content copyrighted ho sakta hai, isliye private rakho).
2. Render > New > Blueprint (ya Web Service) > repo choose karo. `render.yaml` free plan aur settings le leta hai.
3. Environment me `OPENROUTER_API_KEY` aur `OPENROUTER_MODEL` daalo.
4. Deploy hone ke baad URL Android Chrome me kholo > menu (3 dots) > **Add to Home Screen**.

## 5. UptimeRobot (cold start kam karne ke liye)
Free Render service 15 min idle ke baad sleep ho jaati hai. uptimerobot.com par free account banao > New monitor >
HTTP(s) > URL `https://<tumhara-app>.onrender.com/health` > interval **10 minutes**.

## 6. Troubleshooting
- **429 / rate limit**: free OpenRouter models par limit jaldi lagti hai. 20-30 sec ruk kar Retry karo, ya kam requests karo, ya doosra model use karo.
- **"JSON error" / samajh nahi aaya**: kuch free models JSON theek nahi dete. App ek baar khud retry karta hai. Phir bhi aaye to Retry dabao ya model badlo.
- **Pehli request slow**: cold start (service sleep se uthti hai) + models/BM25 lazy load hote hain. UptimeRobot lagao.
- **Model kaise badlein**: Render > Environment > `OPENROUTER_MODEL` change karo > Save (auto redeploy). Local me `.env` edit karo.
- **"<Topic> topic ka PDF nahi hai"**: `chunks.json` me us topic ke chunks nahi hain. PDF `pdfs/<topic>/` me rakho, `python ingest.py` chalao, `chunks.json` commit karke redeploy karo.
- **Progress gayab**: progress browser me hota hai. Browser data clear karne ya doosre phone par jaane se alag hoga. Private mode me storage block ho sakta hai (tab app chalta hai, par save nahi hota).

## Structure
`app.py` routes | `agents.py` LLM, question/evaluator, doubt LangGraph | `retriever.py` BM25 | `ingest.py` offline PDF to chunks |
`make_icons.py` PNG icons | `static/` CSS, JS, manifest, sw.js | `templates/index.html`
