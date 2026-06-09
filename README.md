# WhatsApp Receipt OCR

Automatic Bankily payment receipt extraction from WhatsApp group messages using OCR, powered by **Green API**.

## Architecture

```
WhatsApp
    │
    ▼
Green API ──▶ webhook.js (Node.js/Express)
                    │
           Download image ──▶ data/images/
                    │
           Spawn Python ──▶ pipeline.py
                    │              │
                    │    preprocessor.py (OpenCV)
                    │      → grayscale, OTSU, denoise, 200% upscale
                    │              │
                    │    Tesseract OCR (fra + ara)
                    │              │
                    │    Regex: amount, tx_id, date
                    │              │
                    ▼              ▼
           PostgreSQL ◀── sauvegarder_recu()
                    │
                    ▼
           Reaction ✅ / ⏳ / ❌
           Dashboard 📊 (GET /dashboard)
           API JSON  (GET /api/recus)
           CSV Export (GET /export)
           Weekly report (every Monday 8 AM)
```

## Features

- Webhook Green API — reçoit les images d'un groupe WhatsApp
- OCR bilingue français + arabe (Tesseract + pytesseract)
- Prétraitement d'image (OpenCV : OTSU, débruitage, resize 200%)
- Extraction automatique : montant (MRU), date, ID transaction
- Dédoublonnage par ID transaction unique (`ON CONFLICT DO NOTHING`)
- Score de confiance (0-1) et statut : `ok` / `pending` / `failed`
- Réaction automatique ✅ / ⏳ / ❌ sur chaque message
- Dashboard HTML protégé par mot de passe
- API JSON et export CSV
- Rapport hebdomadaire automatique (lundi 8h)
- Conteneurisé (Docker)

## Prerequisites

- Node.js 18+
- Python 3.11+
- Tesseract OCR avec langues `fra` + `ara`
- PostgreSQL (ou Docker)
- Compte [Green API](https://green-api.com)

## Quick Start

### Without Docker

```bash
# 1. Install dependencies
npm install
pip install -r ocr/requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env with your Green API credentials (see below)

# 3. Start server
npm start
```

### With Docker

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your credentials

# 2. Build and run
docker compose up -d

# 3. View logs
docker compose logs -f
```

### Windows Quick Setup

```powershell
.\start.ps1
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GREEN_API_ID` | Yes | Green API instance ID (e.g. `7107646804`) |
| `GREEN_API_TOKEN` | Yes | Green API access token |
| `GROUP_CHAT_ID` | Yes | Target WhatsApp group chat ID (ends with `@g.us`) |
| `MY_NUMBER` | Yes | Bot's own number to ignore self-messages (e.g. `22242413948@c.us`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/db`) |
| `DASHBOARD_PASS` | No | Dashboard password (default: `admin123`) |
| `PORT` | No | Server port (default: `3000`) |

## Project Structure

```
whatsapp-receipt-ocr/
├── webhook.js              # Entry point — Express webhook server (Green API)
├── package.json            # Node.js dependencies
├── Dockerfile              # Multi-stage container (Python + Node + Tesseract)
├── docker-compose.yml      # Docker orchestration
├── start.ps1               # Windows setup script
├── .env.example            # Environment variable template
├── ocr/
│   ├── pipeline.py         # OCR extraction pipeline (Tesseract + regex)
│   ├── preprocessor.py     # Image preprocessing (OpenCV)
│   └── requirements.txt    # Python dependencies
├── db/
│   ├── database.py         # PostgreSQL operations (psycopg2)
│   └── schema.sql          # Legacy SQLite schema
└── data/
    ├── images/             # Received receipt images
    │   └── debug/          # Preprocessed (debug) images
    └── recus.db            # SQLite (legacy)
```

## Database Schema

### `recus_extraits` (PostgreSQL)

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Auto-increment primary key |
| `date_reception` | TIMESTAMP | Reception timestamp (default NOW()) |
| `nom_legende` | TEXT | Member name from image caption |
| `telephone` | TEXT | Sender phone number |
| `montant` | NUMERIC(10,2) | Extracted amount (MRU) |
| `id_transaction` | TEXT (UNIQUE) | Unique transaction ID |
| `date_transaction` | TEXT | Transaction date |
| `chemin_image` | TEXT | Path to saved image |
| `statut_ocr` | TEXT | `ok` / `pending` / `failed` |
| `raw_ocr_text` | TEXT | Full raw OCR output |
| `confiance` | NUMERIC(3,2) | Confidence score (0.00 to 1.00) |

## OCR Pipeline

The pipeline supports two Bankily receipt formats:

**Format 1 — Transfer:**
```
المبلغ المرسل: 200 MRU
معرف المعامله : 28588 09260606153014
```

**Format 2 — Envoi:**
```
مبلغ 100.0 أوقية جديدة
رقم المعاملة TRO7206911753
```

**Confidence scoring:**
- Base = 1.0
- −0.3 if amount missing
- −0.3 if transaction ID missing
- −0.2 if date missing
- `ok` ≥ 0.7, `pending` < 0.7

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /webhook` | Green API webhook receiver |
| `GET /dashboard?pass=...` | Protected HTML dashboard |
| `GET /api/recus?pass=...` | JSON API for receipts |
| `GET /export?pass=...` | CSV export |
| `GET /chats` | List available group chats |
| `GET /health` | Health check |

## Webhook Setup (Green API)

1. Create account at [green-api.com](https://green-api.com)
2. Create a WhatsApp instance → get `GREEN_API_ID` and `GREEN_API_TOKEN`
3. Set webhook URL in Green API settings to `https://your-domain.com/webhook`
4. Use `GET /chats` to find your group's `chatId`

For local development, use [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

## Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Test OCR pipeline directly
python ocr/pipeline.py data/images/PHOTO-xxx.jpg "caption" "22242413948@c.us"

# List stored receipts
python -c "from db.database import lister_recus; [print(r) for r in lister_recus()]"
```

## License

MIT
