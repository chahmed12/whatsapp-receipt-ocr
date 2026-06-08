require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Green API Config ────────────────────────────────────────────────────────
const GREEN_API_ID = process.env.GREEN_API_ID;
const GREEN_API_TOKEN = process.env.GREEN_API_TOKEN;
const GREEN_API_BASE = `https://api.green-api.com/waInstance${GREEN_API_ID}`;
const GROUP_CHAT_ID = process.env.GROUP_CHAT_ID;
const MY_NUMBER = process.env.MY_NUMBER; // ex: 22242413948@c.us
const DASHBOARD_PASS = process.env.DASHBOARD_PASS || 'admin123';

app.use(morgan('combined'));
app.use(express.json());

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
            if (code === 0) resolve(stdout);
            else reject(new Error(stderr));
        });
    });
}

// ─── Webhook principal ───────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    const body = req.body;
    if (body.typeWebhook !== 'incomingMessageReceived') return;

    const { messageData, senderData, idMessage } = body;
    if (messageData?.typeMessage !== 'imageMessage') return;

    const chatId = senderData?.chatId;
    if (GROUP_CHAT_ID && chatId !== GROUP_CHAT_ID) return;

    // Ignorer ses propres messages
    if (MY_NUMBER && senderData?.sender === MY_NUMBER) return;

    const downloadUrl = messageData.fileMessageData?.downloadUrl;
    const caption = (messageData.fileMessageData?.caption || '').trim();
    const telephone = senderData?.sender || chatId;
    const senderName = senderData?.senderName || telephone;

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

        const pythonScript = path.join(__dirname, 'ocr', 'pipeline.py');
        const stdout = await runPython([pythonScript, imagePath, caption, telephone]);

        const result = JSON.parse(stdout.trim().split('\n').pop());
        console.log(`[OCR] Succès: ${JSON.stringify(result)}`);
        const emoji = result.statut_ocr === 'ok' ? '✅' : '⏳';
        await sendReaction(chatId, idMessage, emoji);

    } catch (err) {
        console.error(`[ERREUR] ${err.message}`);
        await sendReaction(chatId, idMessage, '❌');
    }
});

// ─── Dashboard HTML ──────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
    const pass = req.query.pass;
    if (pass !== DASHBOARD_PASS) {
        return res.status(401).send(`
            <html><body style="font-family:sans-serif;padding:40px;background:#f0f0f0">
            <h2>🔒 Accès Dashboard</h2>
            <form>
                <input type="password" name="pass" placeholder="Mot de passe" style="padding:8px;font-size:16px"/>
                <button type="submit" style="padding:8px 16px;margin-left:8px;background:#25D366;color:white;border:none;border-radius:4px;cursor:pointer">Entrer</button>
            </form>
            </body></html>
        `);
    }

    res.send(`
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>📊 Dashboard Reçus</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Segoe UI', sans-serif; background: #f4f6f9; color: #333; }
            .header { background: #25D366; color: white; padding: 20px 30px; display: flex; justify-content: space-between; align-items: center; }
            .header h1 { font-size: 1.4rem; }
            .stats { display: flex; gap: 16px; padding: 20px 30px; flex-wrap: wrap; }
            .stat-card { background: white; border-radius: 8px; padding: 16px 24px; flex: 1; min-width: 150px; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
            .stat-card .value { font-size: 2rem; font-weight: bold; color: #25D366; }
            .stat-card .label { font-size: 0.85rem; color: #666; margin-top: 4px; }
            .actions { padding: 0 30px 16px; display: flex; gap: 10px; }
            .btn { padding: 8px 18px; border: none; border-radius: 6px; cursor: pointer; font-size: 0.9rem; text-decoration: none; display: inline-block; }
            .btn-export { background: #1a73e8; color: white; }
            .btn-refresh { background: #34a853; color: white; }
            .table-wrap { padding: 0 30px 30px; overflow-x: auto; }
            table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }
            th { background: #25D366; color: white; padding: 12px 14px; text-align: left; font-size: 0.85rem; }
            td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; font-size: 0.85rem; }
            tr:hover td { background: #f9fff9; }
            .badge { padding: 3px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: bold; }
            .ok { background: #d4edda; color: #155724; }
            .pending { background: #fff3cd; color: #856404; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>📊 Dashboard Reçus — رابطة شباب جدة</h1>
            <span id="last-update">Chargement...</span>
        </div>
        <div class="stats">
            <div class="stat-card"><div class="value" id="total">—</div><div class="label">Total reçus</div></div>
            <div class="stat-card"><div class="value" id="montant">—</div><div class="label">Montant total (MRU)</div></div>
            <div class="stat-card"><div class="value" id="semaine">—</div><div class="label">Cette semaine</div></div>
            <div class="stat-card"><div class="value" id="ok_count">—</div><div class="label">OCR validés ✅</div></div>
        </div>
        <div class="actions">
            <a class="btn btn-export" href="/export?pass=${pass}">⬇️ Exporter CSV</a>
            <button class="btn btn-refresh" onclick="loadData()">🔄 Actualiser</button>
        </div>
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>#</th><th>Date</th><th>Envoyeur</th><th>Montant</th>
                        <th>ID Transaction</th><th>Date Transaction</th><th>Statut</th><th>Confiance</th>
                    </tr>
                </thead>
                <tbody id="tbody">
                    <tr><td colspan="8" style="text-align:center;padding:20px">Chargement...</td></tr>
                </tbody>
            </table>
        </div>
        <script>
        async function loadData() {
            const res = await fetch('/api/recus?pass=${pass}');
            const data = await res.json();
            const tbody = document.getElementById('tbody');
            if (!data.recus || data.recus.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px">Aucun reçu</td></tr>';
                return;
            }
            document.getElementById('total').textContent = data.stats.total;
            document.getElementById('montant').textContent = Number(data.stats.montant_total).toLocaleString();
            document.getElementById('semaine').textContent = data.stats.cette_semaine;
            document.getElementById('ok_count').textContent = data.stats.ok_count;
            document.getElementById('last-update').textContent = new Date().toLocaleTimeString('fr-FR');
            tbody.innerHTML = data.recus.map(r => \`
                <tr>
                    <td>\${r.id}</td>
                    <td>\${r.date_reception ? new Date(r.date_reception).toLocaleString('fr-FR') : '—'}</td>
                    <td>\${r.nom_legende || r.telephone || '—'}</td>
                    <td><strong>\${r.montant ? r.montant + ' MRU' : '—'}</strong></td>
                    <td style="font-family:monospace;font-size:0.8rem">\${r.id_transaction || '—'}</td>
                    <td>\${r.date_transaction || '—'}</td>
                    <td><span class="badge \${r.statut_ocr}">\${r.statut_ocr}</span></td>
                    <td>\${r.confiance ? (r.confiance * 100).toFixed(0) + '%' : '—'}</td>
                </tr>
            \`).join('');
        }
        loadData();
        setInterval(loadData, 30000); // actualiser toutes les 30s
        </script>
    </body>
    </html>
    `);
});

// ─── API JSON pour le dashboard ──────────────────────────────────────────────
app.get('/api/recus', async (req, res) => {
    if (req.query.pass !== DASHBOARD_PASS) return res.status(401).json({ error: 'Non autorisé' });
    try {
        const stdout = await runPython(['-c', `
import sys, json, os
sys.path.insert(0, '/app/ocr')
sys.path.insert(0, '/app')
from db.database import lister_recus, stats_semaine
recus = lister_recus(limit=200)
stats = stats_semaine()
# Convertir types non-sérialisables
for r in recus:
    for k, v in r.items():
        if hasattr(v, 'isoformat'):
            r[k] = v.isoformat()
        elif v is not None:
            r[k] = str(v) if not isinstance(v, (int, float, str, bool)) else v
for k, v in stats.items():
    if hasattr(v, 'isoformat'):
        stats[k] = v.isoformat()
    elif v is not None:
        stats[k] = str(v) if not isinstance(v, (int, float, str, bool)) else v
ok_count = sum(1 for r in recus if r.get('statut_ocr') == 'ok')
stats['ok_count'] = ok_count
stats['cette_semaine'] = stats.get('total', 0)
print(json.dumps({'recus': recus, 'stats': stats}, ensure_ascii=False))
`]);
        const data = JSON.parse(stdout.trim().split('\n').pop());
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Export CSV ───────────────────────────────────────────────────────────────
app.get('/export', async (req, res) => {
    if (req.query.pass !== DASHBOARD_PASS) return res.status(401).send('Non autorisé');
    try {
        const stdout = await runPython(['-c', `
import sys, os
sys.path.insert(0, '/app/ocr')
sys.path.insert(0, '/app')
from db.database import exporter_csv
print(exporter_csv())
`]);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename=recus.csv');
        res.send(stdout);
    } catch (err) {
        res.status(500).send('Erreur export: ' + err.message);
    }
});

// ─── Rapport hebdomadaire (tous les lundis à 8h) ──────────────────────────────
async function envoyerRapportHebdo() {
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
        const stats = JSON.parse(stdout.trim());
        const msg =
            `📊 *Rapport hebdomadaire*\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `🧾 Reçus traités : *${stats.total}*\n` +
            `💰 Montant total : *${Number(stats.montant_total).toLocaleString()} MRU*\n` +
            `📅 Semaine du ${new Date().toLocaleDateString('fr-FR')}\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `👉 Dashboard : https://whatsapp-receipt-ocr.onrender.com/dashboard`;

        await axios.post(`${GREEN_API_BASE}/sendMessage/${GREEN_API_TOKEN}`, {
            chatId: MY_NUMBER,
            message: msg
        });
        console.log('[RAPPORT] Rapport hebdomadaire envoyé');
    } catch (err) {
        console.error('[RAPPORT] Erreur:', err.message);
    }
}

// Vérifier toutes les heures si c'est lundi 8h
setInterval(() => {
    const now = new Date();
    if (now.getDay() === 1 && now.getHours() === 8 && now.getMinutes() < 5) {
        envoyerRapportHebdo();
    }
}, 60 * 60 * 1000);

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

app.listen(PORT, () => {
    console.log(`🚀 Webhook Green API prêt sur le port ${PORT}`);
    console.log(`   Groupe cible: ${GROUP_CHAT_ID || '⚠️  non défini'}`);
    console.log(`   Dashboard: http://localhost:${PORT}/dashboard`);
});