# WhatsApp Receipt OCR

> Extraction automatique de reçus de paiement Bankily à partir d'images WhatsApp via OCR.

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Tesseract](https://img.shields.io/badge/Tesseract_OCR-5-49A84B?logo=tesseract&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white)
![Green API](https://img.shields.io/badge/Green_API-25D366?logo=whatsapp&logoColor=white)
![Render](https://img.shields.io/badge/Render-46E3B7?logo=render&logoColor=white)

</div>

---

## Architecture

```
                    ┌──────────────────────────────┐
                    │         WhatsApp Group         │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │         Green API             │
                    │   (webhook notifications)     │
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────▼───────────────┐
                    │    webhook.js (Node.js/Express)│
                    │                              │
                    │  ┌──────────────────────┐    │
                    │  │   Queue FIFO          │    │
                    │  │  (une image à la fois)│    │
                    │  └──────────┬───────────┘    │
                    └─────────────┼─────────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
      ┌───────▼───────┐   ┌──────▼──────┐   ┌───────▼────────┐
      │  pipeline.py   │   │  Commandes  │   │  report.py     │
      │ (Python OCR)   │   │  !stats     │   │ (PDF mensuel)  │
      │                │   │  !moi       │   └────────────────┘
      │  ┌──────────┐  │   │  !dernier   │
      │  │ OpenCV   │  │   │  !aujourdhui│
      │  │ preproc. │  │   │  !rapport   │
      │  └────┬─────┘  │   │  !aide      │
      │       │        │   └──────┬───────┘
      │  ┌────▼─────┐  │          │
      │  │ Tesseract │  │    Réponse WhatsApp
      │  │ fra + ara │  │
      │  └────┬─────┘  │
      │       │        │
      │  ┌────▼─────┐  │
      │  │ Google   │  │  (fallback si conf < 0.7)
      │  │ Vision   │  │
      │  └────┬─────┘  │
      └───────┼─────────┘
              │
      ┌───────▼─────────┐
      │   PostgreSQL     │
      │  ┌────────────┐  │
      │  │ recus_extraits│
      │  └────────────┘  │
      └───────┬─────────┘
              │
      ┌───────▼─────────┐
      │  Réactions       │
      │  ✅ / ⏳ / ❌    │
      │  + notification  │
      │  privée si échec │
      └─────────────────┘
```

---

## Fonctionnalités

| | |
|---|---|
| 🟢 **Webhook Green API** | Réception des images de reçus depuis un groupe WhatsApp |
| 🗂️ **File d'attente FIFO** | Traitement séquentiel des images — pas de conflit |
| 👁️ **Prétraitement OpenCV** | Grayscale, OTSU binarization, median blur, upscale 200% |
| 🔤 **OCR Bilingue** | Tesseract `fra` + `ara` avec fallback Google Cloud Vision |
| 💰 **Extraction intelligente** | Montant (MRU), ID transaction, date — par regex |
| 🎯 **Score de confiance** | `ok` ≥ 0.7 / `pending` ≥ 0.4 / `failed` < 0.4 |
| 🔄 **Dédoublonnage** | `ON CONFLICT DO NOTHING` sur l'ID transaction |
| ✅ **Réactions automatiques** | ✅ OK / ⏳ Faible confiance / ❌ Erreur |
| 📩 **Notification échec** | Message privé à l'expéditeur si l'OCR échoue |
| 💬 **Commandes WhatsApp** | `!stats`, `!moi`, `!dernier`, `!aujourdhui`, `!rapport`, `!aide` |
| 📄 **Rapport mensuel PDF** | Généré et envoyé par WhatsApp via `!rapport` |
| 🧹 **Nettoyage automatique** | Images supprimées après 30 jours |
| 🐳 **Conteneurisé** | Docker + Docker Compose prêt à l'emploi |

---

## Technologies

| Technologie | Rôle |
|-------------|------|
| **Node.js 18+** | Serveur webhook Express.js |
| **Python 3.11+** | Pipeline OCR + génération PDF |
| **Tesseract 5** | OCR avec langues française et arabe |
| **OpenCV** | Prétraitement d'image (seuillage, débruitage, redimensionnement) |
| **Google Cloud Vision** | Fallback OCR automatique (optionnel) |
| **PostgreSQL** | Base de données via psycopg2 |
| **Green API** | API WhatsApp pour webhook, envoi messages et fichiers |
| **fpdf2** | Génération du rapport mensuel PDF |
| **Docker** | Conteneurisation multi-stage (Python + Node + Tesseract) |
| **Render** | Hébergement web service + PostgreSQL |

---

## Prérequis

- Node.js 18+
- Python 3.11+
- Tesseract OCR avec langues `fra` + `ara`
- Base PostgreSQL (Render ou local)
- Compte [Green API](https://green-api.com)

---

## Quick Start

### Avec Docker (recommandé)

```bash
# 1. Cloner le projet
git clone https://github.com/chahmed12/whatsapp-receipt-ocr.git
cd whatsapp-receipt-ocr

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env avec vos identifiants Green API + DATABASE_URL

# 3. Lancer
docker compose up -d

# 4. Voir les logs
docker compose logs -f
```

### Sans Docker

```bash
# 1. Dépendances Node.js
npm install

# 2. Dépendances Python
pip install -r ocr/requirements.txt

# 3. Configuration
cp .env.example .env

# 4. Démarrer
npm start
```

### Windows

```powershell
.\start.ps1
```

---

## Variables d'environnement

### Requises

| Variable | Description |
|----------|-------------|
| `GREEN_API_ID` | ID de l'instance Green API |
| `GREEN_API_TOKEN` | Token d'accès Green API |
| `GROUP_CHAT_ID` | ID du groupe WhatsApp cible (ex: `123456789@g.us`) |
| `MY_NUMBER` | Numéro du bot pour ignorer ses propres messages (ex: `22242413948@c.us`) |
| `DATABASE_URL` | URL de connexion PostgreSQL (ex: `postgresql://user:pass@host:5432/db`) |

### Optionnelles

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3000` | Port du serveur (Render définit automatiquement `10000`) |
| `FALLBACK_PROVIDER` | `none` | `google` pour activer le fallback Google Cloud Vision |
| `FALLBACK_API_KEY` | — | Clé API Google Cloud Vision (nécessaire si `FALLBACK_PROVIDER=google`) |
| `REPORT_PHONE` | `MY_NUMBER` | Numéro destinataire du rapport PDF mensuel |
| `RENDER_URL` | `http://localhost:3000` | URL publique de l'application (ex: `https://mon-app.onrender.com`) |
| `CRON_SECRET` | — | Secret pour sécuriser l'endpoint de téléchargement du PDF |
| `IMAGE_RETENTION_DAYS` | `30` | Durée de conservation des images reçues |

---

## Commandes WhatsApp

Envoyez ces commandes dans le groupe WhatsApp :

| Commande | Description |
|----------|-------------|
| `!stats` | Statistiques de la semaine (total reçus, montant cumulé) |
| `!moi` | Mes statistiques personnelles |
| `!dernier` | Dernier reçu traité |
| `!aujourdhui` | Récapitulatif du jour |
| `!rapport` | Génère et envoie le PDF mensuel par WhatsApp |
| `!aide` | Liste complète des commandes |

---

## Endpoints HTTP

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| `POST` | `/webhook` | Réception des notifications Green API (images + commandes) |
| `GET` | `/chats` | Liste des groupes WhatsApp disponibles |
| `GET` | `/health` | Health check du service |
| `GET` | `/temp/:filename?key=...` | Téléchargement de fichier temporaire (rapport PDF) |

---

## OCR Pipeline

### Formats de reçus supportés

**Format 1 — Transfert bancaire :**
```
المبلغ المرسل: 200 MRU
معرف المعامله : 28588 09260606153014
```

**Format 2 — Envoi :**
```
مبلغ 100.0 أوقية جديدة
رقم المعاملة TRO7206911753
```

### Score de confiance

| Condition | Pénalité |
|-----------|----------|
| Montant manquant | −0.3 |
| ID transaction manquant | −0.3 |
| Date manquante | −0.2 |

| Score | Statut |
|-------|--------|
| ≥ 0.7 | `ok` ✅ |
| ≥ 0.4 | `pending` ⏳ |
| < 0.4 | `failed` ❌ |

Si `FALLBACK_PROVIDER=google` et score < 0.7, un fallback Google Cloud Vision est automatiquement déclenché.

---

## Structure du projet

```
whatsapp-receipt-ocr/
│
├── webhook.js                 # Serveur Express.js (webhook + queue + commandes)
├── package.json               # Dépendances Node.js
├── Dockerfile                 # Image multi-stage (Python + Node + Tesseract)
├── docker-compose.yml         # Orchestration Docker
├── .env.example               # Template des variables d'environnement
├── start.ps1                  # Script d'installation Windows
│
├── ocr/
│   ├── pipeline.py            # Pipeline OCR (Tesseract + regex + fallback)
│   ├── preprocessor.py        # Prétraitement d'image (OpenCV)
│   ├── report.py              # Génération du rapport mensuel PDF
│   └── requirements.txt       # Dépendances Python
│
├── db/
│   ├── database.py            # Opérations PostgreSQL (psycopg2)
│   └── schema.sql             # Schéma SQLite (legacy)
│
├── fonts/                     # Polices téléchargées pour le PDF (runtime)
│
└── data/
    ├── images/                # Images de reçus reçues
    │   └── debug/             # Versions prétraitées (debug)
    └── recus.db               # Base SQLite (legacy)
```

---

## Déploiement (Render)

Le service est conçu pour fonctionner sur le plan **gratuit** de Render.

### 1. Base de données PostgreSQL

Créer une base PostgreSQL sur Render → copier le `DATABASE_URL` interne.

### 2. Web Service

| Champ | Valeur |
|-------|--------|
| **Build Command** | `npm install && pip install -r ocr/requirements.txt` |
| **Start Command** | `npm start` |
| **Plan** | Free |

Ajouter toutes les variables d'environnement dans le dashboard Render.

### 3. Webhook Green API

Configurer l'URL du webhook dans le compte Green API :
```
https://votre-app.onrender.com/webhook
```

### Développement local

```bash
# Avec ngrok pour exposer le serveur local
ngrok http 3000
```

---

## Développement

```bash
# Mode watch (redémarrage automatique)
npm run dev

# Tester le pipeline OCR
python ocr/pipeline.py data/images/PHOTO-xxx.jpg "caption" "22242413948@c.us"

# Générer un rapport PDF de test
python ocr/report.py 2026 6 data

# Lister les reçus en base
python -c "from db.database import lister_recus; [print(r) for r in lister_recus()]"

# Statistiques par téléphone
python -c "from db.database import stats_telephone; print(stats_telephone('222000000000@c.us'))"
```

---

## Licence

MIT — Projet open source réalisé pour la **رابطة شباب جدة** (Jeddah Youth Association).
