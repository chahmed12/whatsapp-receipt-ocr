-- Table principale de stockage des reçus extraits
CREATE TABLE IF NOT EXISTS recus_extraits (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nom_legende     TEXT NOT NULL,
    telephone       VARCHAR(20) NOT NULL,
    montant         NUMERIC(10,2),
    id_transaction  VARCHAR(50) UNIQUE,
    date_transaction TEXT,
    chemin_image    TEXT,
    statut_ocr      TEXT CHECK(statut_ocr IN ('ok', 'pending', 'failed')) DEFAULT 'ok',
    raw_ocr_text    TEXT,
    confiance       REAL,
    date_reception  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    webhook_log     TEXT
);

-- Index pour recherche rapide
CREATE INDEX IF NOT EXISTS idx_telephone ON recus_extraits(telephone);
CREATE INDEX IF NOT EXISTS idx_id_transaction ON recus_extraits(id_transaction);
CREATE INDEX IF NOT EXISTS idx_statut ON recus_extraits(statut_ocr);
CREATE INDEX IF NOT EXISTS idx_date_reception ON recus_extraits(date_reception);
