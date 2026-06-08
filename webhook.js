require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || 'data/recus.db';

// ─── Green API Config ────────────────────────────────────────────────────────
const GREEN_API_ID = process.env.GREEN_API_ID;       // ex: 1234567890
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;    // ex: abcdef1234...
const GREEN_API_BASE = `https://api.green-api.com/waInstance${GREEN_API_ID}`;

// ID du groupe de l'association (format: XXXXXXXXXXX@g.us)
// Récupéré via /getChats après avoir rejoint le groupe
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;

app.use(morgan('combined'));
app.use(express.json());

// ─── Envoyer une réaction emoji sur un message spécifique ───────────────────
async function sendReaction(chatId, messageId, emoji) {
    try {
        await axios.post(
            `${GREEN_API_BASE}/sendReaction/${GREEN_API_TOKEN}`,
            {
                chatId,
                messageId,
                reaction: emoji
            }
        );
        console.log(`[REACTION] ${emoji} sur message ${messageId}`);
    } catch (err) {
        console.error(`[REACTION] Erreur: ${err.response?.data || err.message}`);
    }
}

// ─── Télécharger le fichier média depuis Green API ──────────────────────────
async function downloadMedia(downloadUrl) {
    const response = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
}

// ─── Webhook principal ───────────────────────────────────────────────────────
// Green API envoie un POST pour chaque message reçu
app.post('/webhook', async (req, res) => {
    res.sendStatus(200); // Toujours répondre 200 immédiatement

    const body = req.body;

    // Ignorer tout ce qui n'est pas un message entrant
    if (body.typeWebhook !== 'incomingMessageReceived') return;

    const { messageData, senderData, idMessage } = body;

    // Ignorer les messages qui ne sont pas des images
    if (messageData?.typeMessage !== 'imageMessage') return;

    // Filtrer : seulement le groupe de l'association
    const chatId = senderData?.chatId;
    if (GROUP_CHAT_ID && chatId !== GROUP_CHAT_ID) {
        console.log(`[FILTRE] Message ignoré depuis: ${chatId}`);
        return;
    }

    const downloadUrl = messageData.fileMessageData?.downloadUrl;
    const caption = (messageData.fileMessageData?.caption || '').trim();
    const telephone = senderData?.sender || chatId;
    const senderName = senderData?.senderName || telephone;

    console.log(`[RECU] De: ${senderName} (${telephone}), Légende: "${caption}"`);

    if (!downloadUrl) {
        console.error('[ERREUR] downloadUrl manquant');
        return;
    }

    try {
        // 1. Télécharger l'image
        const imageBuffer = await downloadMedia(downloadUrl);

        const timestamp = Date.now();
        const safePhone = telephone.replace(/\D/g, '');
        const imageName = `PHOTO-${safePhone}-${timestamp}.jpg`;
        const imagePath = path.join(__dirname, 'data', 'images', imageName);

        fs.mkdirSync(path.dirname(imagePath), { recursive: true });
        fs.writeFileSync(imagePath, imageBuffer);
        console.log(`[IMAGE] Sauvegardée: ${imagePath}`);

        // 2. Lancer le pipeline OCR Python (identique à avant)
        const pythonScript = path.join(__dirname, 'ocr', 'pipeline.py');
        const proc = spawn('python', [pythonScript, imagePath, caption, telephone, DB_PATH]);

        let stdout = '', stderr = '';
        proc.stdout.on('data', d => stdout += d.toString());
        proc.stderr.on('data', d => stderr += d.toString());

        proc.on('close', async code => {
            if (code === 0) {
                try {
                    const result = JSON.parse(stdout.trim().split('\n').pop());
                    console.log(`[OCR] Succès: ${JSON.stringify(result)}`);
                    const emoji = result.statut_ocr === 'ok' ? '✅' : '⏳';
                    await sendReaction(chatId, idMessage, emoji);
                } catch (e) {
                    console.log(`[OCR] Sortie brute: ${stdout}`);
                    await sendReaction(chatId, idMessage, '⏳');
                }
            } else {
                console.error(`[OCR] Erreur (code ${code}): ${stderr}`);
                await sendReaction(chatId, idMessage, '❌');
            }
        });

    } catch (err) {
        console.error(`[ERREUR] Traitement message: ${err.message}`);
        await sendReaction(chatId, idMessage, '❌');
    }
});

// ─── Endpoint utilitaire : lister les chats pour trouver le GROUP_CHAT_ID ───
// GET /chats → appelle Green API et retourne la liste des groupes
app.get('/chats', async (req, res) => {
    try {
        const response = await axios.get(`${GREEN_API_BASE}/getChats/${GREEN_API_TOKEN}`);
        const groups = response.data.filter(c => c.id.endsWith('@g.us'));
        res.json(groups.map(g => ({ name: g.name, chatId: g.id })));
    } catch (err) {
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

// ─── Health check ────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', group: GROUP_CHAT_ID || 'non configuré' });
});

app.listen(PORT, () => {
    console.log(`🚀 Webhook Green API prêt sur le port ${PORT}`);
    console.log(`   DB: ${DB_PATH}`);
    console.log(`   Groupe cible: ${GROUP_CHAT_ID || '⚠️  GROUP_CHAT_ID non défini'}`);
});