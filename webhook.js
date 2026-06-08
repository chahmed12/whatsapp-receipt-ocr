require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';
const MEDIA_URL = `https://graph.facebook.com/${API_VERSION}`;
const DB_PATH = process.env.DB_PATH || 'data/recus.db';

app.use(morgan('combined'));
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf.toString(); } }));

function verifySignature(req, res, buf) {
    const signature = req.headers['x-hub-signature-256'];
    if (!signature) return false;
    const expected = crypto
        .createHmac('sha256', process.env.APP_SECRET)
        .update(JSON.stringify(req.body))
        .digest('hex');
    return crypto.timingSafeEqual(
        Buffer.from(signature.replace('sha256=', '')),
        Buffer.from(expected)
    );
}

async function sendReaction(to, messageId, emoji) {
    try {
        await axios.post(
            `${MEDIA_URL}/${PHONE_NUMBER_ID}/messages`,
            {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'reaction',
                reaction: { message_id: messageId, emoji }
            },
            { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        console.log(`[REACTION] ${emoji} envoyée à ${to} sur message ${messageId}`);
    } catch (err) {
        console.error(`[REACTION] Erreur: ${err.response?.data?.error?.message || err.message}`);
    }
}

app.get(WEBHOOK_PATH, (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[WEBHOOK] Verifié avec succès');
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

app.post(WEBHOOK_PATH, async (req, res) => {
    res.sendStatus(200);

    const body = req.body;
    if (!body?.entry?.[0]?.changes?.[0]?.value?.messages) return;

    for (const message of body.entry[0].changes[0].value.messages) {
        if (message.type !== 'image') continue;

        const telephone = message.from;
        const caption = (message.image.caption || '').trim();
        const mediaId = message.image.id;
        const messageId = message.id;

        console.log(`[RECU] De: ${telephone}, Légende: "${caption}", MediaID: ${mediaId}`);

        try {
            const mediaResp = await axios.get(`${MEDIA_URL}/${mediaId}`, {
                headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
            });
            const mediaUrl = mediaResp.data.url;

            const imageResp = await axios.get(mediaUrl, {
                headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
                responseType: 'stream'
            });

            const timestamp = Date.now();
            const safePhone = telephone.replace(/\D/g, '');
            const imageName = `PHOTO-${safePhone}-${timestamp}.jpg`;
            const imagePath = path.join(__dirname, 'data', 'images', imageName);
            const writer = fs.createWriteStream(imagePath);

            imageResp.data.pipe(writer);
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            console.log(`[IMAGE] Sauvegardée: ${imagePath}`);

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
                        await sendReaction(telephone, messageId, emoji);
                    } catch (e) {
                        console.log(`[OCR] Sortie brute: ${stdout}`);
                        await sendReaction(telephone, messageId, '⏳');
                    }
                } else {
                    console.error(`[OCR] Erreur (code ${code}): ${stderr}`);
                    await sendReaction(telephone, messageId, '❌');
                }
            });
        } catch (err) {
            console.error(`[ERREUR] Traitement message: ${err.message}`);
        }
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Webhook WhatsApp prêt sur le port ${PORT}`);
    console.log(`   Chemin: ${WEBHOOK_PATH}`);
    console.log(`   DB: ${DB_PATH}`);
});
