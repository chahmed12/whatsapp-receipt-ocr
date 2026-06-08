import os
import sys
import csv
import io
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

DATABASE_URL = os.environ.get('DATABASE_URL')

CSV_COLUMNS = [
    'id', 'date_reception', 'nom_legende', 'telephone',
    'montant', 'id_transaction', 'date_transaction',
    'statut_ocr', 'confiance', 'chemin_image'
]

SCHEMA = """
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
"""

def get_connection():
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    return conn

def initialiser_db():
    conn = get_connection()
    with conn.cursor() as cur:
        cur.execute(SCHEMA)
    conn.commit()
    conn.close()

def sauvegarder_recu(data, db_path=None):
    # db_path ignoré — on utilise PostgreSQL
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO recus_extraits
                    (nom_legende, telephone, montant, id_transaction,
                     date_transaction, chemin_image, statut_ocr, raw_ocr_text, confiance)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id_transaction) DO NOTHING
            """, (
                data['nom_legende'],
                data['telephone'],
                data['montant'],
                data['id_transaction'],
                data['date_transaction'],
                data['chemin_image'],
                data['statut_ocr'],
                data['raw_ocr_text'],
                data['confiance']
            ))
            conn.commit()
            if cur.rowcount > 0:
                print(f"[DB] Enregistré: {data.get('nom_legende')} - {data.get('montant')} MRU", file=sys.stderr)
            else:
                print(f"[DB] Doublon ignoré (id_transaction): {data['id_transaction']}", file=sys.stderr)
    except Exception as e:
        print(f"[DB] Erreur: {e}", file=sys.stderr)
    finally:
        conn.close()

def lister_recus(statut=None, limit=200):
    conn = get_connection()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        if statut:
            cur.execute(
                "SELECT * FROM recus_extraits WHERE statut_ocr = %s ORDER BY date_reception DESC LIMIT %s",
                (statut, limit)
            )
        else:
            cur.execute(
                "SELECT * FROM recus_extraits ORDER BY date_reception DESC LIMIT %s",
                (limit,)
            )
        rows = cur.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def exporter_csv():
    recus = lister_recus(limit=10000)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=CSV_COLUMNS)
    writer.writeheader()
    for r in recus:
        writer.writerow({col: r.get(col, '') for col in CSV_COLUMNS})
    return output.getvalue()

def stats_semaine():
    conn = get_connection()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT
                COUNT(*)                          AS total,
                COALESCE(SUM(montant), 0)         AS montant_total,
                MAX(date_reception)               AS derniere_reception
            FROM recus_extraits
            WHERE date_reception >= NOW() - INTERVAL '7 days'
        """)
        row = cur.fetchone()
    conn.close()
    return dict(row)

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'init':
        initialiser_db()
        print("Base PostgreSQL initialisée")