import sys
import json
import re
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytesseract
from preprocessor import preprocess, save_debug
from db.database import sauvegarder_recu

import platform
if platform.system() == 'Windows':
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
# Sur Linux (Docker), tesseract est dans le PATH par défaut

CUSTOM_CONFIG = r'--oem 3 --psm 4 -l fra+ara'

def _clean_text(text):
    return text.replace('\u200e', '').replace('\u200f', '')

def extract_amount(text):
    text = _clean_text(text)
    patterns = [
        r'(?:المبلغ المرسل|المبلغ|مبلغ)\s*:?\s*([\d\s,.]+)',
        r'(?:montant|MT|prix|total|somme)\s*:?\s*([\d\s,.]+)',
        r'([\d\s,.]+)\s*(?:MRU|UM|MRO|أوقية|ouguiya)',
        r'(?:MRU|UM|MRO)\s*:?\s*([\d\s,.]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            cleaned = re.sub(r'\s+', '', match.group(1)).replace(',', '.')
            try:
                return float(cleaned)
            except ValueError:
                continue
    return None

def extract_transaction_id(text):
    text = _clean_text(text)
    patterns = [
        r'(?:رقم المعاملة|معرف المعامله|رقم العملية)\s*:?\s*([A-Z0-9\s]{8,25})',
        r'(?:ID|N[°o]?|num[ée]ro|r[ée]f[ée]rence)\s*:?\s*([A-Z0-9]{8,25})',
        r'([A-Z]{2,5}\d{8,20})',
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return re.sub(r'\s+', '', match.group(1))
    return None

def extract_date(text):
    text = _clean_text(text)
    patterns = [
        r'(\d{2})[-/](\d{2})[-/](\d{4})',
        r'(\d{2})[-/](\d{2})[-/](\d{2})',
        r'(\d{4})[-/](\d{2})[-/](\d{2})',
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            d, m, y = match.group(1), match.group(2), match.group(3)
            if len(y) == 2:
                y = '20' + y if int(y) < 50 else '19' + y
            return f'{d}-{m}-{y}'
    return None

def run(image_path, caption, telephone, db_path):
    debug_dir = os.path.join(os.path.dirname(image_path), 'debug')
    os.makedirs(debug_dir, exist_ok=True)

    processed = preprocess(image_path)

    debug_path = os.path.join(debug_dir, os.path.basename(image_path))
    save_debug(processed, debug_path)

    ocr_text = pytesseract.image_to_string(processed, config=CUSTOM_CONFIG)

    montant = extract_amount(ocr_text)
    id_transaction = extract_transaction_id(ocr_text)
    date_transaction = extract_date(ocr_text)

    lines = [l.strip() for l in ocr_text.split('\n') if l.strip()]
    confiance = 1.0
    if montant is None:
        confiance -= 0.3
    if id_transaction is None:
        confiance -= 0.3
    if date_transaction is None:
        confiance -= 0.2

    statut = 'ok' if confiance >= 0.7 else 'pending'

    result = {
        'statut_ocr': statut,
        'nom_legende': caption,
        'telephone': telephone,
        'montant': montant,
        'id_transaction': id_transaction,
        'date_transaction': date_transaction,
        'chemin_image': image_path,
        'raw_ocr_text': ocr_text,
        'confiance': round(confiance, 2)
    }

    sauvegarder_recu(result, db_path)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({'error': 'Usage: pipeline.py <image_path> <caption> <telephone> [db_path]'}))
        sys.exit(1)

    image_path = sys.argv[1]
    caption = sys.argv[2]
    telephone = sys.argv[3]
    db_path = sys.argv[4] if len(sys.argv) > 4 else 'data/recus.db'

    run(image_path, caption, telephone, db_path)
