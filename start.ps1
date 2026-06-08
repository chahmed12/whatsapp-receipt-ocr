Write-Host "=== Installation des dépendances Node.js ===" -ForegroundColor Cyan
Set-Location -LiteralPath $PSScriptRoot
npm install

Write-Host "`n=== Installation des dépendances Python ===" -ForegroundColor Cyan
pip install -r ocr/requirements.txt

Write-Host "`n=== Initialisation de la base SQLite ===" -ForegroundColor Cyan
python db/database.py init data/recus.db

Write-Host "`n=== Création du fichier .env ===" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath ".env")) {
    Copy-Item -LiteralPath ".env.example" -Destination ".env"
    Write-Host "Fichier .env créé depuis .env.example"
    Write-Host "-> Modifie-le avec tes identifiants WhatsApp Cloud API" -ForegroundColor Yellow
} else {
    Write-Host ".env déjà existant, ignoré"
}

Write-Host "`n=== Prêt ===" -ForegroundColor Green
Write-Host "Lancement sans Docker : npm start" -ForegroundColor Cyan
Write-Host "Lancement avec Docker  : docker compose up -d" -ForegroundColor Cyan
