#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# Deploy Weerrecords update – 1 april 2026
# Draait knmi_records.py, commit gewijzigde bestanden en pusht naar remote
# ═══════════════════════════════════════════════════════════════════════════

set -e
cd "/Users/aldus/KNMI_Project/weerkaarten 2"

echo "════════════════════════════════════════════════════"
echo "  Deploy Weerrecords update"
echo "════════════════════════════════════════════════════"
echo ""

# ── Stap 1: Weerrecords JSON genereren ──────────────────────────────────
echo "📊 Stap 1/3: knmi_records.py draaien (alle stations)..."
echo "   Dit kan een paar minuten duren..."
python3 -u scripts/knmi_records.py
echo ""
echo "✅ Alle records JSON-bestanden gegenereerd"
echo ""

# ── Stap 2: Bestanden stagen ────────────────────────────────────────────
echo "📁 Stap 2/3: Bestanden stagen voor commit..."

# Frontend bestanden
git add records_debilt.html
git add nieuw.html
git add index.html

# Backend script
git add scripts/knmi_records.py

# Alle records JSON bestanden
git add records_*.json

# Dit deploy script zelf
git add deploy_records_update.sh

echo "   Gestaged:"
git diff --cached --stat

echo ""

# ── Stap 3: Commit en push ─────────────────────────────────────────────
echo "🚀 Stap 3/3: Commit en push..."

if git diff --cached --quiet; then
    echo "⚠️  Geen wijzigingen om te committen"
else
    git commit -m "Weerrecords update $(date '+%Y-%m-%d %H:%M') – normaalwaarden, klimaatdagen, breadcrumb"
    git push
    echo ""
    echo "✅ Alles gepusht naar remote!"
fi

echo ""
echo "════════════════════════════════════════════════════"
echo "  Klaar! Wijzigingen:"
echo "  • Breadcrumb context-indicator"
echo "  • Warme dagen ≥20°C in klimaatdagengrafiek"
echo "  • Klimaatdagen per maand in maandranking"
echo "  • Normaalwaarden 1991-2020 in maandoverzicht"
echo "  • Station wisselen werkt nu overal"
echo "  • nieuw.html en index.html bijgewerkt"
echo "════════════════════════════════════════════════════"
