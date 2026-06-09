import sys
import os
import locale
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import requests
from db.database import lister_recus_par_mois
from fpdf import FPDF

try:
    locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
except locale.Error:
    try:
        locale.setlocale(locale.LC_TIME, 'fr_FR')
    except locale.Error:
        pass

FONT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'fonts')
FONT_REGULAR_URL = 'https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Regular.ttf'
FONT_BOLD_URL = 'https://github.com/google/fonts/raw/main/ofl/notosans/NotoSans-Bold.ttf'
FONT_REGULAR_PATH = os.path.join(FONT_DIR, 'NotoSans-Regular.ttf')
FONT_BOLD_PATH = os.path.join(FONT_DIR, 'NotoSans-Bold.ttf')

def ensure_font(filename, url, path):
    if os.path.exists(path):
        return
    os.makedirs(FONT_DIR, exist_ok=True)
    print(f"[FONT] Téléchargement {filename}...", file=sys.stderr)
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    with open(path, 'wb') as f:
        f.write(r.content)
    print(f"[FONT] {filename} OK", file=sys.stderr)

def generate_monthly_pdf(annee, mois, output_path):
    recus = lister_recus_par_mois(annee, mois)
    nom_mois = datetime(annee, mois, 1).strftime('%B %Y')

    ensure_font('NotoSans-Regular.ttf', FONT_REGULAR_URL, FONT_REGULAR_PATH)
    ensure_font('NotoSans-Bold.ttf', FONT_BOLD_URL, FONT_BOLD_PATH)

    pdf = FPDF()
    pdf.add_font('NotoSans', '', FONT_REGULAR_PATH, uni=True)
    pdf.add_font('NotoSans', 'B', FONT_BOLD_PATH, uni=True)
    pdf.set_auto_page_break(auto=True, margin=15)

    pdf.add_page()
    pdf.set_font('NotoSans', 'B', 18)
    pdf.cell(0, 12, f'Rapport Mensuel - {nom_mois}', ln=True, align='C')
    pdf.ln(8)

    total_montant = 0
    ok_count = 0
    pending_count = 0
    failed_count = 0

    for r in recus:
        total_montant += float(r.get('montant') or 0)
        s = r.get('statut_ocr', '')
        if s == 'ok': ok_count += 1
        elif s == 'failed': failed_count += 1
        else: pending_count += 1

    pdf.set_font('NotoSans', '', 11)
    pdf.cell(0, 8, f"Total reçus: {len(recus)}", ln=True)
    pdf.cell(0, 8, f"Montant total: {total_montant:,.2f} MRU", ln=True)
    pdf.cell(0, 8, f"OK: {ok_count}  |  Pending: {pending_count}  |  Failed: {failed_count}", ln=True)
    pdf.ln(8)

    if recus:
        col_widths = [10, 40, 50, 25, 65]
        headers = ['#', 'Date', 'Envoyeur', 'Montant', 'ID Transaction']
        pdf.set_font('NotoSans', 'B', 9)
        pdf.set_fill_color(37, 211, 102)
        pdf.set_text_color(255, 255, 255)
        for i, h in enumerate(headers):
            pdf.cell(col_widths[i], 8, h, border=1, fill=True, align='C')
        pdf.ln()

        pdf.set_font('NotoSans', '', 8)
        pdf.set_text_color(0, 0, 0)
        for idx, r in enumerate(recus, 1):
            date_str = r.get('date_reception', '')
            if hasattr(date_str, 'strftime'):
                date_str = date_str.strftime('%d/%m/%Y')
            else:
                date_str = str(date_str)[:10]

            if idx % 2 == 0:
                pdf.set_fill_color(245, 245, 245)
                fill = True
            else:
                fill = False

            pdf.cell(col_widths[0], 7, str(idx), border=1, fill=fill, align='C')
            pdf.cell(col_widths[1], 7, date_str, border=1, fill=fill, align='C')
            pdf.cell(col_widths[2], 7, (r.get('nom_legende') or r.get('telephone') or '—')[:30], border=1, fill=fill)
            montant = r.get('montant') or '—'
            if montant != '—':
                montant = f"{float(montant):,.0f}"
            pdf.cell(col_widths[3], 7, str(montant), border=1, fill=fill, align='R')
            pdf.cell(col_widths[4], 7, (r.get('id_transaction') or '—')[:20], border=1, fill=fill)
            pdf.ln()

    pdf.output(output_path)
    return output_path

if __name__ == '__main__':
    now = datetime.now()
    annee = int(sys.argv[1]) if len(sys.argv) > 1 else now.year
    mois = int(sys.argv[2]) if len(sys.argv) > 2 else now.month
    output_dir = sys.argv[3] if len(sys.argv) > 3 else 'data'

    os.makedirs(output_dir, exist_ok=True)
    output_path = os.path.join(output_dir, f'rapport-{annee}-{mois:02d}.pdf')

    try:
        generate_monthly_pdf(annee, mois, output_path)
        print(output_path)
    except Exception as e:
        print(f"ERREUR: {e}", file=sys.stderr)
        sys.exit(1)
