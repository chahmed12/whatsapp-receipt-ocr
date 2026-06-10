require('dotenv').config();
const { Pool } = require('pg');
const axios = require('axios');

// Configurez ici la base de données (sur Render, DATABASE_URL est automatique)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// ============================================================================
// VOS DOCUMENTS POUR L'ASSOCIATION (EN ARABE)
// Modifiez ces textes avec les vraies règles de votre association.
// ============================================================================
const documents = [
    {
        titre: "قواعد استرداد الأموال (Règles de remboursement)",
        contenu: "يجب تقديم إيصالات الدفع الأصلية في غضون 30 يومًا من تاريخ الشراء. لا نقبل الصور غير الواضحة أو الممزقة. يتم تعويض المبالغ نقدًا أو عبر التحويل البنكي."
    },
    {
        titre: "أهداف الجمعية (Objectifs de l'association)",
        contenu: "نهدف إلى تقديم الدعم المالي والشفافية التامة لجميع أعضائنا. يتم تخصيص 10% من الميزانية للطوارئ."
    },
    {
        titre: "الأسئلة الشائعة (FAQ)",
        contenu: "إذا كان الإيصال ممزقًا أو غير مقروء، يرجى كتابة التفاصيل على ورقة منفصلة وتوقيعها، ثم إرفاقها مع صورة الإيصال للجنة المراجعة."
    },
    {
        titre: "القانون الداخلي لرابطة شباب جدة",
        contenu: "رابطة شباب جدة جمعية شبابية ثقافية ورياضية واجتماعية، غير ربحية. أهدافها: تعزيز التعاون بين الشباب، تنظيم الأنشطة، تمثيل الشباب، وترسيخ القيم الوطنية. العضوية مفتوحة لكل من يلتزم بالقانون. الهيكلة: الرئيس، المكتب التنفيذي، اللجان. مدة المسؤوليات سنتان قابلة للتجديد. تتخذ القرارات بالأغلبية."
    },
    {
        titre: "نظام التبرعات والاشتراكات (محضر الاجتماع)",
        contenu: "تم الاتفاق على اعتماد نظام تبرعات لدعم أنشطة الرابطة (بالأوقية القديمة): 1000 أوقية قديمة شهرياً لكل شاب. 2000 أوقية قديمة شهرياً للأعضاء العاملين في المكتب التنفيذي. 1000 أوقية للأعضاء غير العاملين. سيتم إنشاء مكتب تنفيذي خاص بالنساء ومجموعة واتساب خاصة بهن."
    },
    {
        titre: "الهيكلة الجديدة للمكتب التنفيذي (Nouvelle Structure du Bureau Exécutif)",
        contenu: "اعتمدت رابطة شباب جدة هيكلة تنفيذية جديدة.\nالرئيس: سعدبوه الشيخ محمد فاضل.\nنائب الرئيس: محمد عالي ساكده.\nمستشارو الرئيس: الشيخ أحمد أعمر عمو، تيته شنلي لحمود، محمد لمين امحيميد.\nالأمين العام (ممثل الشباب): محمدون اللب.\nنائب الأمين العام: عبدالله اعبيدالله.\nمسؤول التنظيم: أباه أحمدو.\nأمين الخزينة (الناطق الرسمي): امربيه البلي.\nنائب أمين الخزينة: محمد سيدي.\nنائب الناطق الرسمي: سيدي محمد اللب.\nمسؤول الشؤون الداخلية والرقمنة: الشيخ أحمد زنفور.\nمسؤول الإعلام والاتصال: محمد دمب.\nمسؤول المبادرات والتطوع: الحسن محمد ناجم.\nمسؤول العلاقات العامة: عبودي اللب.\nمسؤولو الرياضة: ابراهيم جيري، عبدالله عبدو، مولاي اللب، مختار حبيله، سليمان لحمود، يسلم محمود، ابوه ساكده.\nمسؤولو الثقافة: سيدي محمد اللب، الشيخ النين."
    }
];

async function seed() {
    console.log("🚀 Début de l'injection des connaissances (RAG)...");
    
    if (!process.env.HF_API_KEY) {
        console.error("❌ ERREUR: HF_API_KEY est manquant dans le fichier .env");
        process.exit(1);
    }

    try {
        // S'assurer que pgvector et la table existent
        await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS connaissances_association (
                id SERIAL PRIMARY KEY,
                titre TEXT,
                contenu TEXT,
                embedding vector(384)
            );
        `);
        
        // Optionnel : Vider la table avant d'ajouter les nouveaux documents
        // await pool.query('TRUNCATE connaissances_association');

        for (const doc of documents) {
            console.log(`⏳ Vectorisation de : "${doc.titre}"...`);
            
            // Transformer le texte arabe en vecteurs via HuggingFace
            const hfResponse = await axios.post(
                'https://api-inference.huggingface.co/pipeline/feature-extraction/intfloat/multilingual-e5-small',
                { inputs: doc.contenu },
                { headers: { Authorization: `Bearer ${process.env.HF_API_KEY}` } }
            );
            
            let embedding = hfResponse.data;
            if (Array.isArray(embedding) && Array.isArray(embedding[0])) {
                embedding = embedding[0];
            }
            
            const pgvectorStr = `[${embedding.join(',')}]`;
            
            // Sauvegarder dans PostgreSQL
            await pool.query(
                `INSERT INTO connaissances_association (titre, contenu, embedding) VALUES ($1, $2, $3)`,
                [doc.titre, doc.contenu, pgvectorStr]
            );
            console.log(`✅ Injecté : ${doc.titre}`);
        }
        
        console.log("🎉 Terminé ! Votre bot WhatsApp connaît maintenant ces règles.");
    } catch (err) {
        console.error("❌ Erreur pendant l'injection :", err.message);
    } finally {
        await pool.end();
    }
}

seed();
