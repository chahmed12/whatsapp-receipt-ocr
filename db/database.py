import sqlite3
import os
import sys
import json
import csv
from datetime import datetime

SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'schema.sql')

CSV_COLUMNS = [
    'id', 'date_reception', 'nom_legende', 'telephone',
    'montant', 'id_transaction', 'date_transaction',
    'statut_ocr', 'confiance', 'chemin_image'
]

def get_connection(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn

def initialiser_db(db_path):
    os.makedirs(os.path.dirname(db_path) or '.', exist_ok=True)
    with open(SCHEMA_PATH, 'r') as f:
        schema = f.read()
    conn = get_connection(db_path)
    conn.executescript(schema)
    conn.commit()
    conn.close()

def _csv_path(db_path):
    """Retourne le chemin du CSV correspondant a la DB."""
    base = os.path.splitext(db_path)[0]
    return base + '.csv'

def _append_to_csv(data, db_path, row_id):
    """Ajoute une ligne au CSV. Cree le fichier avec en-tetes si necessaire."""
    csv_path = _csv_path(db_path)
    file_exists = os.path.exists(csv_path)

    with open(csv_path, 'a', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        if not file_exists:
            writer.writeheader()
        writer.writerow({
            'id':               row_id,
            'date_reception':   datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S'),
            'nom_legende':      data.get('nom_legende', ''),
            'telephone':        data.get('telephone', ''),
            'montant':          data.get('montant', ''),
            'id_transaction':   data.get('id_transaction', ''),
            'date_transaction': data.get('date_transaction', ''),
            'statut_ocr':       data.get('statut_ocr', ''),
            'confiance':        data.get('confiance', ''),
            'chemin_image':     data.get('chemin_image', ''),
        })

def sauvegarder_recu(data, db_path):
    if not os.path.exists(db_path):
        initialiser_db(db_path)
    else:
        conn = get_connection(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='recus_extraits'")
        if not cursor.fetchone():
            initialiser_db(db_path)
        conn.close()

    conn = get_connection(db_path)
    try:
        cursor = conn.execute("""
            INSERT INTO recus_extraits
                (nom_legende, telephone, montant, id_transaction,
                 date_transaction, chemin_image, statut_ocr, raw_ocr_text, confiance)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        row_id = cursor.lastrowid
        print(f"[DB] Enregistre: {data['nom_legende']} - {data.get('montant', '?')} MRU", file=sys.stderr)

        # Export CSV simultane
        _append_to_csv(data, db_path, row_id)
        print(f"[CSV] Ligne ajoutee -> {_csv_path(db_path)}", file=sys.stderr)

    except sqlite3.IntegrityError:
        print(f"[DB] Doublon ignore (id_transaction): {data['id_transaction']}", file=sys.stderr)
    finally:
        conn.close()

def lister_recus(db_path, statut=None, limit=50):
    if not os.path.exists(db_path):
        return []
    conn = get_connection(db_path)
    if statut:
        rows = conn.execute(
            "SELECT * FROM recus_extraits WHERE statut_ocr = ? ORDER BY date_reception DESC LIMIT ?",
            (statut, limit)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM recus_extraits ORDER BY date_reception DESC LIMIT ?",
            (limit,)
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def exporter_csv_complet(db_path):
    """Regenere le CSV complet depuis la DB (utile pour reconstruire apres perte)."""
    csv_path = _csv_path(db_path)
    recus = lister_recus(db_path, limit=10000)
    with open(csv_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for r in recus:
            writer.writerow({col: r.get(col, '') for col in CSV_COLUMNS})
    print(f"CSV exporte: {csv_path} ({len(recus)} lignes)")
    return csv_path

if __name__ == '__main__':
    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        db_path = sys.argv[2] if len(sys.argv) > 2 else 'data/recus.db'
        if cmd == 'init':
            initialiser_db(db_path)
            print(f"Base initialisee: {db_path}")
        elif cmd == 'export-csv':
            exporter_csv_complet(db_path)
