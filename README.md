# WhatsApp Receipt OCR

Automatic Bankily payment receipt extraction from WhatsApp group messages using OCR, powered by Meta's official WhatsApp Cloud API.

## Architecture

```
WhatsApp Cloud API (Meta)
        │ webhook
        ▼
┌────────────────┐     ┌────────────────┐     ┌──────────────┐
│  webhook.js    │────▶│  pipeline.py   │────▶│   SQLite     │
│  (Node.js)     │     │  (Python OCR)  │     │  recus.db    │
└────────────────┘     └────────────────┘     └──────────────┘
        │                                            │
        ▼                                            ▼
   Reaction ✅/⏳/❌                           recus_extraits
```

## Features

- Webhook WhatsApp Cloud API sécurisé (signature X-Hub-Signature-256)
- OCR bilingue français + arabe (Pytesseract)
- Extraction automatique : montant, date, ID transaction
- Dédoublonnage par ID transaction unique
- Statut OCR : `ok` / `pending` / `failed`
- Réaction automatique ✅ / ⏳ / ❌ sur chaque message
- Prétraitement d'image (OTSU, resize 200%, débruitage)
- Stockage SQLite intégré
- Conteneurisé (Docker)

## Prerequisites

- Node.js 18+
- Python 3.11+
- Tesseract OCR (`fra` + `ara`)
- Docker (optionnel)
- Compte Meta Developer + WhatsApp Cloud API

## Quick Start

### Without Docker

```bash
# 1. Install dependencies
npm install
pip install -r ocr/requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env with your WhatsApp Cloud API credentials

# 3. Initialize database
python db/database.py init data/recus.db

# 4. Start server
npm start
```

### With Docker

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your WhatsApp Cloud API credentials

# 2. Build and run
docker compose up -d

# 3. View logs
docker compose logs -f
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WHATSAPP_TOKEN` | WhatsApp Cloud API System User Token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Phone Number ID |
| `WHATSAPP_API_VERSION` | Meta API version (default: v21.0) |
| `VERIFY_TOKEN` | Webhook verification token (choose any string) |
| `PORT` | Server port (default: 3000) |
| `DB_PATH` | SQLite database path (default: data/recus.db) |

## Project Structure

```
whatsapp-receipt-ocr/
├── webhook.js              # WhatsApp Cloud API webhook server
├── package.json            # Node.js dependencies
├── docker-compose.yml      # Docker orchestration
├── Dockerfile              # Container image
├── ocr/
│   ├── pipeline.py         # OCR extraction pipeline
│   ├── preprocessor.py     # Image preprocessing
│   └── requirements.txt    # Python dependencies
├── db/
│   ├── schema.sql          # SQLite schema
│   └── database.py         # Database operations
└── data/
    ├── images/             # Received receipt images
    └── recus.db            # SQLite database
```

## Database Schema

### `recus_extraits`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | Auto-increment primary key |
| `nom_legende` | TEXT | Member name from image caption |
| `telephone` | VARCHAR | Sender phone number |
| `montant` | NUMERIC | Extracted amount (MRU) |
| `id_transaction` | VARCHAR | Unique transaction ID |
| `date_transaction` | TEXT | Transaction date |
| `chemin_image` | TEXT | Path to saved image |
| `statut_ocr` | TEXT | `ok` / `pending` / `failed` |
| `raw_ocr_text` | TEXT | Raw OCR output |
| `confiance` | REAL | Confidence score (0-1) |
| `date_reception` | TIMESTAMP | Reception timestamp |

## OCR Extraction

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

## Development

```bash
# Watch mode (auto-restart on changes)
npm run dev

# Test database
python test_pipeline.py

# List stored receipts
python -c "from db.database import lister_recus; [print(r) for r in lister_recus('data/recus.db')]"
```

## Webhook Setup (Meta)

1. Create app at [developers.facebook.com](https://developers.facebook.com)
2. Add WhatsApp product
3. Configure webhook: `https://your-domain.com/webhook`
4. Subscribe to `messages` webhook field
5. Verify with your `VERIFY_TOKEN`

For local development, use [ngrok](https://ngrok.com):

```bash
ngrok http 3000
```

## License

MIT
