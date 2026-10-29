# AI "Describe shipment" — Google Gemini setup

The AI helper turns a free-text route/cargo description into a **suggestion** the
user reviews and applies to the form. It never calculates, saves, geocodes or
fabricates coordinates. The provider is **Google Gemini only**. It is **off by
default** (`AI_ENABLED=false`) and the rest of the site works without it.

> Budget for extra AI cost: **0 €.** This integration never activates a paid
> plan, auto top-up, or a switch to another provider. **A configured key is not
> proof that your usage is free** — you must verify eligibility yourself (below).

## What is implemented and verified

- A real Gemini client (`backend/src/services/ai/geminiClient.js`) calling
  `POST {GEMINI_BASE_URL}/v1beta/models/{GEMINI_MODEL}:generateContent` with
  `responseMimeType: application/json`, a timeout, and stable error mapping.
- Server-only key use; the key never reaches the browser, `/api/config`, logs or
  error bodies. No key field in the public form.
- The authenticated endpoint `POST /api/ai/parse-shipment` (behind the shared
  access protection, CSRF guard, per-IP rate limit and a shared **daily cap**
  `AI_DAILY_MAX`, default 50).
- Server-side validation and normalisation of every field (quantity in kg, bulk
  density optional incl. 0, grain type whitelist, places as text to confirm).
- Graceful fallback: when disabled, out of quota, key rejected, or on any error,
  the UI shows *"DI šiuo metu nepasiekiamas. Užpildykite formą rankiniu būdu."*
  (EN: *"AI is currently unavailable. Fill the form manually."*) and the manual
  form keeps working. No paid fallback is ever called.
- Tests use a **mocked** Gemini response — no paid request is made in CI.

## What you must verify before enabling (free-tier + EU terms)

The build could not reach Google, so these must be checked in **your own** Google
account at deploy time:

1. **Free-tier eligibility for your project + model.** In Google AI Studio
   (https://aistudio.google.com/) create an API key. Check the current rate
   limits / free-tier for the chosen `GEMINI_MODEL` (e.g. `gemini-2.5-flash`) on
   https://ai.google.dev/gemini-api/docs/rate-limits and the pricing page. Free
   limits and model availability change; confirm they cover a few dozen requests
   per day.
2. **Whether a paid/billing plan is required for your use.** If the free tier
   does not cover your project/model/region, **leave `AI_ENABLED=false`** — do
   not enable billing just to turn this on.
3. **Terms for EU users.** Confirm the current Google/Gemini API terms permit
   your specific use for end users in Lithuania/the EU
   (https://ai.google.dev/gemini-api/terms). If data-handling or regional terms
   do not fit, keep AI disabled.

If any of these does not hold, the correct outcome is **AI off, manual form on**.

## Enabling it (once verified)

Set these as **server environment variables** (on Render: Dashboard → your
service → Environment → Add Environment Variable). Never put the key in Git, the
browser, or any file in this repo.

| Key | Value |
| --- | --- |
| `GEMINI_API_KEY` | your Google AI Studio key (server secret only) |
| `GEMINI_MODEL` | e.g. `gemini-2.5-flash` (a small, free-tier-eligible model) |
| `AI_ENABLED` | `true` — only after steps 1–3 above check out |

Optional: `AI_DAILY_MAX` (shared daily call cap, default 50), `AI_MAX_INPUT_CHARS`
(default 2000), `AI_TIMEOUT_MS` (default 15000). Then **Save and deploy** (or
rebuild) so the running server picks up the change.

Verify with the "Aprašyk krovinį" box: a short description should return a
suggestion for review; nothing changes until you press "Pritaikyti formai".

## Turning it off / rotating the key

Set `AI_ENABLED=false` (and/or remove `GEMINI_API_KEY`), then redeploy/restart so
the running process drops the key from memory. Revoke the key in Google AI Studio
if it may have been exposed. The manual form and all calculations keep working.

## Scope

- No general chatbot, no tools, no SQL/file/network access from the feature.
- All route and cost numbers come from the app's own logic and the routing/geocoding
  providers — not from the model.
- Fuel-price suggestions (LEA) are independent of Gemini and have their own setup
  (`docs/logistics-module.md` / `.env.example`). Manual fuel price always works.
