require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const morgan = require('morgan');
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

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

        // Envoyer un résumé à l'Administrateur
        const adminPhone = process.env.ADMIN_PHONE;
        if (adminPhone) {
            const montantTexte = result.montant ? `${result.montant}` : 'Inconnu';
            const adminMsg = `Nouveau reçu de ${senderName} : ${montantTexte} MRU. Statut: ${emoji}`;
            await sendMessage(adminPhone, adminMsg);
        }

        // Notification d'échec UNIQUEMENT en message privé (silencieux dans le groupe)
        const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
        if (!GROUP_CHAT_ID || chatId !== GROUP_CHAT_ID) {
            if (result.statut_ocr === 'failed' || (result.confiance && result.confiance < 0.4)) {
                const msg =
                    `❌ Désolé ${senderName}, je n'ai pas pu lire ton reçu.\n` +
                    `Essaie avec une photo plus nette (bien cadrée, sans ombre).`;
                await sendMessage(chatId, msg);
            }
        }
    } catch (err) {
        console.error(`[ERREUR] ${senderName}: ${err.message}`);
        await sendReaction(chatId, idMessage, '❌');
    }
}

// ─── Traiter une question RAG (Intelligence Artificielle) ──────────────────
async function processRag(question, chatId, idMessage, senderName) {
    if (!process.env.GROQ_API_KEY || !process.env.HF_API_KEY) {
        console.log(`[RAG] Ignoré car GROQ_API_KEY ou HF_API_KEY manquant.`);
        return;
    }

    try {
        await sendReaction(chatId, idMessage, '⏳');

        // 1. Vectorisation de la question avec HuggingFace
        const hfResponse = await axios.post(
            'https://api-inference.huggingface.co/pipeline/feature-extraction/intfloat/multilingual-e5-small',
            { inputs: question },
            { headers: { Authorization: `Bearer ${process.env.HF_API_KEY}` } }
        );
        
        let embedding = hfResponse.data;
        if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
            embedding = embedding[0]; // Gérer le format de tableau imbriqué
        }
        
        // 2. Recherche des documents pertinents dans PostgreSQL
        const pgvectorStr = `[${embedding.join(',')}]`;
        const res = await pool.query(`
            SELECT titre, contenu, 1 - (embedding <=> $1::vector) as similarity
            FROM connaissances_association
            WHERE 1 - (embedding <=> $1::vector) > 0.70
            ORDER BY similarity DESC
            LIMIT 3
        `, [pgvectorStr]);

        let context = "";
        if (res.rows.length > 0) {
            context = res.rows.map(r => `[Document: ${r.titre}]\n${r.contenu}`).join('\n\n');
        } else {
            context = "Aucun document spécifique trouvé. Réponds de manière générale et courtoise.";
        }

        // 3. Génération de la réponse en Arabe avec Groq
        const systemPrompt = `Tu es l'assistant intelligent et officiel d'une association.
Tu dois répondre aux questions des membres poliment, de façon concise et professionnelle.
CRITIQUE: Tu dois répondre EXCLUSIVEMENT EN LANGUE ARABE (Arabe clair et naturel).
Utilise les documents suivants pour baser ta réponse, si pertinents :
${context}`;

        const groqResponse = await axios.post(
            'https://api.groq.com/openai/v1/chat/completions',
            {
                model: 'llama3-70b-8192',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: question }
                ],
                temperature: 0.3,
                max_tokens: 500
            },
            { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
        );

        const reply = groqResponse.data.choices[0]?.message?.content;
        if (reply) {
            await sendMessage(chatId, reply);
            await sendReaction(chatId, idMessage, '🤖');
        }

    } catch (err) {
        console.error(`[RAG ERREUR] ${err.message}`);
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
            const res = await pool.query(`
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(montant), 0) AS montant_total
                FROM recus_extraits
                WHERE date_reception >= NOW() - INTERVAL '7 days'
            `);
            const stats = res.rows[0];
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
            const res = await pool.query(`
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(montant), 0) AS montant_total
                FROM recus_extraits
                WHERE telephone = $1
            `, [telephone]);
            const data = res.rows[0];
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
            const res = await pool.query(`
                SELECT * FROM recus_extraits ORDER BY date_reception DESC LIMIT 1
            `);
            const r = res.rows[0];
            if (!r) {
                reply = `📭 Aucun reçu traité pour l'instant.`;
            } else {
                const confMsg = r.confiance ? Math.round(Number(r.confiance) * 100) + '%' : '—';
                const dateStr = r.date_transaction ? r.date_transaction : '—';
                reply =
                    `📄 *Dernier reçu*\n` +
                    `━━━━━━━━━━━━━━━━\n` +
                    `👤 ${r.nom_legende || r.telephone || '—'}\n` +
                    `💰 ${r.montant || '—'} MRU\n` +
                    `🔖 ${r.id_transaction || '—'}\n` +
                    `📅 ${dateStr}\n` +
                    `✅ Statut: ${r.statut_ocr} (${confMsg})`;
            }
        } catch (err) {
            reply = `❌ Erreur: ${err.message}`;
        }
    } else if (cmd === '!aujourdhui') {
        try {
            const res = await pool.query(`
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(montant), 0) AS montant_total
                FROM recus_extraits
                WHERE date_reception >= CURRENT_DATE
            `);
            const data = res.rows[0];
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
    // Log the type of webhook received for debugging
    console.log(`[WEBHOOK RAW] typeWebhook: ${body.typeWebhook}, typeMessage: ${body.messageData?.typeMessage}, chatId: ${body.senderData?.chatId}`);

    if (body.typeWebhook !== 'incomingMessageReceived') return;

    const { messageData, senderData, idMessage } = body;
    const chatId = senderData?.chatId;
    const telephone = senderData?.sender || chatId;
    const senderName = senderData?.senderName || telephone;

    // Commande texte (Messages Privés uniquement)
    if (messageData?.typeMessage === 'textMessage' || messageData?.typeMessage === 'extendedTextMessage') {
        if (GROUP_CHAT_ID && chatId === GROUP_CHAT_ID) {
            // Le bot est silencieux dans le groupe de l'association, il ignore le texte
            return;
        }

        const text = (messageData.textMessageData?.textMessage || messageData.extendedTextMessageData?.text || '').trim();
        if (text.startsWith('!')) {
            console.log(`[CMD] ${senderName}: ${text}`);
            await processCommand(text.split(/\s+/)[0], chatId, idMessage, senderName, telephone);
        } else if (text.length > 5) {
            console.log(`[RAG] Question de ${senderName}: ${text}`);
            await processRag(text, chatId, idMessage, senderName);
        }
        return;
    }

    // Image (Reçus acceptés dans le Groupe ET en Message Privé)
    if (messageData?.typeMessage !== 'imageMessage') return;
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

// ─── Route pour injecter les données RAG (Alternative au Shell Render) ──────
app.get('/seed-database', async (req, res) => {
    try {
        const seed = require('./seed_rag');
        await seed();
        res.send("<h1>✅ Succès !</h1><p>Les règles de l'association ont été mémorisées par l'Intelligence Artificielle.</p>");
    } catch (err) {
        res.status(500).send(`<h1>❌ Erreur</h1><p>${err.message}</p>`);
    }
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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS recus_extraits (
                id               SERIAL PRIMARY KEY,
                date_reception   TIMESTAMP DEFAULT NOW(),
                nom_legende      TEXT,
                telephone        TEXT,
                montant          NUMERIC(10,2),
                id_transaction   TEXT UNIQUE,
                date_transaction TEXT,
                chemin_image     TEXT,
                statut_ocr       TEXT,
                raw_ocr_text     TEXT,
                confiance        NUMERIC(3,2)
            );
        `);
        console.log('[DB] PostgreSQL prêt (via Node.js pg)');
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
