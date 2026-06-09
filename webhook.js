require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Config ──────────────────────────────────────────────────────────────────
const GREEN_API_ID = process.env.GREEN_API_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_API_BASE = `https://api.green-api.com/waInstance${GREEN_API_ID}`;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const MY_NUMBER = process.env.MY_NUMBER;
const REPORT_PHONE = process.env.REPORT_PHONE || MY_NUMBER;
const RENDER_URL = process.env.RENDER_URL || `http://localhost:${PORT}`;
const CRON_SECRET = process.env.CRON_SECRET;
const IMAGE_RETENTION_DAYS = parseInt(process.env.IMAGE_RETENTION_DAYS || '30', 10);

app.use(morgan('combined'));
app.use(express.json());

// ─── File d'attente FIFO ─────────────────────────────────────────────────────
const imageQueue = [];
let isProcessing = false;

function processQueue() {
    if (isProcessing || imageQueue.length === 0) return;
    isProcessing = true;
    const task = imageQueue.shift();
    processImage(task).finally(() => {
        isProcessing = false;
        processQueue();
    });
}

// ─── Envoyer un message WhatsApp ──────────────────────────────────────────────
async function sendMessage(chatId, message) {
    try {
        await axios.post(`${GREEN_API_BASE}/sendMessage/${GREEN_API_TOKEN}`, {
            chatId, message
        });
        console.log(`[MSG] Envoyé à ${chatId}: ${message.slice(0, 60)}`);
    } catch (err) {
        console.error(`[MSG] Erreur: ${err.response?.data || err.message}`);
    }
}

// ─── Réaction emoji sur un message ──────────────────────────────────────────
async function sendReaction(chatId, messageId, emoji) {
    try {
        await axios.post(`${GREEN_API_BASE}/sendReaction/${GREEN_API_TOKEN}`, {
            chatId, messageId, reaction: emoji
        });
        console.log(`[REACTION] ${emoji} sur message ${messageId}`);
    } catch (err) {
        console.error(`[REACTION] Erreur: ${err.response?.data || err.message}`);
    }
}

// ─── Télécharger média ───────────────────────────────────────────────────────
async function downloadMedia(downloadUrl) {
    const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
}

// ─── Appel Python helper ─────────────────────────────────────────────────────
function runPython(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('python', args);
        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());
        proc.on('close', code => {
            if (code === 0) resolve(stdout.trim());
            else reject(new Error(stderr));
        });
    });
}

// ─── Traiter une image (queue) ──────────────────────────────────────────────
async function processImage({ imagePath, caption, telephone, chatId, idMessage, senderName }) {
    try {
        const pythonScript = path.join(__dirname, 'ocr', 'pipeline.py');
        const stdout = await runPython([pythonScript, imagePath, caption, telephone]);
        const result = JSON.parse(stdout.split('\n').pop());

        console.log(`[OCR] ${senderName}: ${JSON.stringify(result)}`);

        const emoji = result.statut_ocr === 'ok' ? '✅' : result.statut_ocr === 'failed' ? '❌' : '⏳';
        await sendReaction(chatId, idMessage, emoji);

        // Notification échec
        if (result.statut_ocr === 'failed' || (result.confiance && result.confiance < 0.4)) {
            const msg =
                `❌ Désolé ${senderName}, je n'ai pas pu lire ton reçu.\n` +
                `Essaie avec une photo plus nette (bien cadrée, sans ombre).`;
            await sendMessage(telephone, msg);
        }
    } catch (err) {
        console.error(`[ERREUR] ${senderName}: ${err.message}`);
        await sendReaction(chatId, idMessage, '❌');
    }
}

// ─── Traiter une commande ! ──────────────────────────────────────────────────
async function processCommand(cmd, chatId, idMessage, senderName, telephone) {
    let reply = '';

    if (cmd === '!aide') {
        reply =
            `📋 *Commandes disponibles*\n` +
            `━━━━━━━━━━━━━━━━\n` +
            `!stats — Stats de la semaine\n` +
            `!moi — Mes stats personnelles\n` +
            `!dernier — Dernier reçu traité\n` +
            `!aujourdhui — Récap du jour\n` +
            `!rapport — Rapport PDF du mois\n` +
            `!aide — Cette liste`;
    } else if (cmd === '!stats') {
        try {
            const stdout = await runPython(['-c', `
import sys, os, json
sys.path.insert(0, '/app/ocr')
sys.path.insert(0, '/app')
from db.database import stats_semaine
s = stats_semaine()
for k, v in s.items():
    if hasattr(v, 'isoformat'): s[k] = v.isoformat()
    elif v is not None: s[k] = str(v) if not isinstance(v, (int, float, str, bool)) else v
print(json.dumps(s))
`]);
            const stats = JSON.parse(stdout);
            reply =
                `📊 *Stats de la semaine*\n` +
                `━━━━━━━━━━━━━━━━━━\n` +
                `🧾 Reçus traités : *${stats.total}*\n` +
                `💰 Montant total : *${Number(stats.montant_total).toLocaleString()} MRU*`;
        } catch (err) {
            reply = `❌ Erreur: ${err.message}`;
        }
    } else if (cmd === '!moi') {
        try {
            const safeTelephone = telephone.replace(/'/g, "''");
            const stdout = await runPython(['-c', `
import sys, os, json
sys.path.insert(0, '/app/ocr')
sys.path.insert(0, '/app')
from db.database import lister_recus_par_telephone, stats_telephone
recus = lister_recus_par_telephone("${safeTelephone}")
stats = stats_telephone("${safeTelephone}")
print(json.dumps({'total': stats['total'], 'montant_total': float(stats['montant_total'])}))
`]);
            const data = JSON.parse(stdout);
            reply =
                `👤 *Mes stats*\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `🧾 Reçus envoyés : *${data.total}*\n` +
                `💰 Montant total : *${Number(data.montant_total).toLocaleString()} MRU*`;
        } catch (err) {
            reply = `❌ Erreur: ${err.message}`;
        }
    } else if (cmd === '!dernier') {
        try {
            const stdout = await runPython(['-c', `
import sys, os, json
sys.path.insert(0, '/app/ocr')
sys.path.insert(0, '/app')
from db.database import lister_recus
recus = lister_recus(limit=1)
if not recus:
    print(json.dumps(None))
else:
    r = recus[0]
    for k, v in r.items():
        if hasattr(v, 'isoformat'): r[k] = v.isoformat()
        elif v is not None: r[k] = str(v) if not isinstance(v, (int, float, str, bool)) else v
    print(json.dumps(r))
`]);
            const r = JSON.parse(stdout);
            if (!r) {
                reply = `📭 Aucun reçu traité pour l'instant.`;
            } else {
                reply =
                    `📄 *Dernier reçu*\n` +
                    `━━━━━━━━━━━━━━━━\n` +
                    `👤 ${r.nom_legende || r.telephone || '—'}\n` +
                    `💰 ${r.montant || '—'} MRU\n` +
                    `🔖 ${r.id_transaction || '—'}\n` +
                    `📅 ${r.date_transaction || '—'}\n` +
                    `✅ Statut: ${r.statut_ocr} (${r.confiance ? Math.round(r.confiance * 100) + '%' : '—'})`;
            }
        } catch (err) {
            reply = `❌ Erreur: ${err.message}`;
        }
    } else if (cmd === '!aujourdhui') {
        try {
            const today = new Date();
            const start = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}T00:00:00`;
            const end = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}T23:59:59`;
            const stdout = await runPython(['-c', `
import sys, os, json
sys.path.insert(0, '/app/ocr')
sys.path.insert(0, '/app')
from db.database import lister_recus_par_date
recus = lister_recus_par_date("${start}", "${end}")
total = len(recus)
montant = sum(float(r.get('montant') or 0) for r in recus)
print(json.dumps({'total': total, 'montant_total': montant}))
`]);
            const data = JSON.parse(stdout);
            reply =
                `📅 *Récap du jour*\n` +
                `━━━━━━━━━━━━━━━━\n` +
                `🧾 Reçus aujourd'hui : *${data.total}*\n` +
                `💰 Montant total : *${Number(data.montant_total).toLocaleString()} MRU*`;
        } catch (err) {
            reply = `❌ Erreur: ${err.message}`;
        }
    } else if (cmd === '!rapport') {
        if (!CRON_SECRET || !RENDER_URL || !REPORT_PHONE) {
            reply = `❌ Rapport non configuré (CRON_SECRET, RENDER_URL ou REPORT_PHONE manquant).`;
        } else {
            try {
                const now = new Date();
                const annee = now.getFullYear();
                const mois = now.getMonth() + 1;
                const stdout = await runPython([
                    path.join(__dirname, 'ocr', 'report.py'),
                    String(annee), String(mois), path.join(__dirname, 'data')
                ]);
                const pdfPath = stdout.trim();
                if (pdfPath.startsWith('ERREUR') || !fs.existsSync(pdfPath)) {
                    reply = `❌ Erreur lors de la génération du PDF.`;
                } else {
                    const fileName = path.basename(pdfPath);
                    const fileUrl = `${RENDER_URL}/temp/${fileName}?key=${CRON_SECRET}`;
                    await axios.post(`${GREEN_API_BASE}/sendFileByUrl/${GREEN_API_TOKEN}`, {
                        chatId: REPORT_PHONE,
                        urlFile: fileUrl,
                        fileName: fileName,
                        caption: `📄 Rapport mensuel ${now.toLocaleString('fr-FR', { month: 'long', year: 'numeric' })}`
                    });
                    reply = `✅ Rapport mensuel envoyé à ${REPORT_PHONE}`;
                    setTimeout(() => {
                        try { fs.unlinkSync(pdfPath); } catch {}
                    }, 60000);
                }
            } catch (err) {
                reply = `❌ Erreur: ${err.message}`;
            }
        }
    } else {
        reply = `❌ Commande inconnue. Tape *!aide* pour voir la liste.`;
    }

    if (reply) {
        await sendMessage(chatId, reply);
    }
}

// ─── Webhook principal ──────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return;

    const { messageData, senderData, idMessage } = body;
    const chatId = senderData?.chatId;
    const telephone = senderData?.sender || chatId;
    const senderName = senderData?.senderName || telephone;

    // Commande texte !
    if (messageData?.typeMessage === 'textMessage') {
        const text = (messageData.textMessageData?.textMessage || '').trim();
        if (text.startsWith('!')) {
            console.log(`[CMD] ${senderName}: ${text}`);
            await processCommand(text.split(/\s+/)[0], chatId, idMessage, senderName, telephone);
        }
        return;
    }

    // Image
    if (messageData?.typeMessage !== 'imageMessage') return;
    if (GROUP_CHAT_ID && chatId !== GROUP_CHAT_ID) return;
    if (MY_NUMBER && senderData?.sender === MY_NUMBER) return;

    const downloadUrl = messageData.fileMessageData?.downloadUrl;
    const caption = (messageData.fileMessageData?.caption || '').trim();

    console.log(`[RECU] De: ${senderName} (${telephone}), Légende: "${caption}"`);
    if (!downloadUrl) return;

    try {
        const imageBuffer = await downloadMedia(downloadUrl);
        const timestamp = Date.now();
        const safePhone = telephone.replace(/\D/g, '');
        const imageName = `PHOTO-${safePhone}-${timestamp}.jpg`;
        const imagePath = path.join(__dirname, 'data', 'images', imageName);

        fs.mkdirSync(path.dirname(imagePath), { recursive: true });
        fs.writeFileSync(imagePath, imageBuffer);
        console.log(`[IMAGE] Sauvegardée: ${imagePath}`);

        // Ajouter à la file d'attente
        imageQueue.push({ imagePath, caption, telephone, chatId, idMessage, senderName });
        processQueue();
    } catch (err) {
        console.error(`[ERREUR] Téléchargement: ${err.message}`);
        await sendReaction(chatId, idMessage, '❌');
    }
});

// ─── Fichier temporaire (pour le rapport PDF) ──────────────────────────────
app.get('/temp/:filename', (req, res) => {
    if (!CRON_SECRET || req.query.key !== CRON_SECRET) return res.status(401).end();
    const filePath = path.join(__dirname, 'data', req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.sendFile(filePath, err => {
        if (!err) {
            setTimeout(() => {
                try { fs.unlinkSync(filePath); } catch {}
            }, 1000);
        }
    });
});

// ─── Utilitaires ─────────────────────────────────────────────────────────────
app.get('/chats', async (req, res) => {
    try {
        const response = await axios.get(`${GREEN_API_BASE}/getChats/${GREEN_API_TOKEN}`);
        const groups = response.data.filter(c => c.id.endsWith('@g.us'));
        res.json(groups.map(g => ({ name: g.name, chatId: g.id })));
    } catch (err) {
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', group: GROUP_CHAT_ID || 'non configuré' });
});

// ─── Démarrage ──────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
    console.log(`🚀 Webhook Green API prêt sur le port ${PORT}`);
    console.log(`   Groupe cible: ${GROUP_CHAT_ID || '⚠️  non défini'}`);

    // Init DB
    try {
        await runPython(['-c', `
import sys
sys.path.insert(0, '/app/ocr')
sys.path.insert(0, '/app')
from db.database import initialiser_db
initialiser_db()
print('[DB] Table initialisée')
`]);
        console.log('[DB] PostgreSQL prêt');
    } catch (err) {
        console.error('[DB] Erreur init:', err.message);
    }

    // Nettoyage des anciennes images
    try {
        const imagesDir = path.join(__dirname, 'data', 'images');
        if (fs.existsSync(imagesDir)) {
            const files = fs.readdirSync(imagesDir);
            const now = Date.now();
            let deleted = 0;
            for (const file of files) {
                const filePath = path.join(imagesDir, file);
                const stat = fs.statSync(filePath);
                const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
                if (ageDays > IMAGE_RETENTION_DAYS) {
                    fs.unlinkSync(filePath);
                    deleted++;
                }
            }
            // Nettoyer aussi le dossier debug
            const debugDir = path.join(imagesDir, 'debug');
            if (fs.existsSync(debugDir)) {
                const debugFiles = fs.readdirSync(debugDir);
                for (const file of debugFiles) {
                    const filePath = path.join(debugDir, file);
                    const stat = fs.statSync(filePath);
                    const ageDays = (now - stat.mtimeMs) / (1000 * 60 * 60 * 24);
                    if (ageDays > IMAGE_RETENTION_DAYS) {
                        fs.unlinkSync(filePath);
                        deleted++;
                    }
                }
            }
            if (deleted > 0) console.log(`[CLEAN] ${deleted} image(s) supprimée(s)`);
        }
    } catch (err) {
        console.error('[CLEAN] Erreur:', err.message);
    }
});
