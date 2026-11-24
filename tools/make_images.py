"""Genera una imagen SVG por producto a partir del seed SQL.

Lee db/003_seed_catalog.sql, extrae (sku, nombre, marca, categoría) y dibuja una
tarjeta con el color de su categoría. Sin red ni dependencias: los SVG se sirven
como archivos estáticos y se cachean en el service worker.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "db" / "003_seed_catalog.sql"
OUT = ROOT / "assets" / "img"
OUT.mkdir(parents=True, exist_ok=True)

COLORS = {
    "laptops": ("#1e3a8a", "#3b82f6"),
    "smartphones": ("#4c1d95", "#8b5cf6"),
    "audio": ("#064e3b", "#10b981"),
    "accesorios": ("#7c2d12", "#f97316"),
    "monitores": ("#164e63", "#06b6d4"),
    "almacenamiento": ("#7f1d1d", "#ef4444"),
}

ROW = re.compile(
    r"\('(?P<sku>[A-Z]{3}-\d{3})','(?P<name>[^']+)','(?P<desc>[^']*)','(?P<brand>[^']+)',\s*'(?P<cat>[a-z]+)'"
)

TEMPLATE = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600" role="img" aria-label="{name}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.04"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#bg)"/>
  <circle cx="660" cy="90" r="180" fill="#ffffff" opacity="0.07"/>
  <circle cx="120" cy="540" r="150" fill="#000000" opacity="0.12"/>
  <rect x="150" y="170" width="500" height="270" rx="22" fill="url(#glass)" stroke="#ffffff" stroke-opacity="0.35" stroke-width="2"/>
  <rect x="182" y="202" width="436" height="176" rx="10" fill="#0b1020" opacity="0.55"/>
  <rect x="212" y="234" width="{bar1}" height="14" rx="7" fill="#ffffff" opacity="0.75"/>
  <rect x="212" y="262" width="{bar2}" height="10" rx="5" fill="#ffffff" opacity="0.45"/>
  <rect x="212" y="284" width="{bar3}" height="10" rx="5" fill="#ffffff" opacity="0.3"/>
  <rect x="330" y="440" width="140" height="16" rx="8" fill="#ffffff" opacity="0.5"/>
  <text x="60" y="90" font-family="system-ui,Segoe UI,sans-serif" font-size="26" font-weight="700" fill="#ffffff" opacity="0.92">{brand}</text>
  <text x="60" y="520" font-family="system-ui,Segoe UI,sans-serif" font-size="40" font-weight="800" fill="#ffffff">{name}</text>
  <text x="60" y="560" font-family="ui-monospace,monospace" font-size="22" fill="#ffffff" opacity="0.7">{sku}</text>
</svg>
"""

rows = ROW.findall(SEED.read_text(encoding="utf-8"))
made = 0
for sku, name, _desc, brand, cat in rows:
    c1, c2 = COLORS.get(cat, ("#1f2937", "#4b5563"))
    short = name if len(name) <= 26 else name[:25] + "…"
    svg = TEMPLATE.format(
        name=short, brand=brand, sku=sku, c1=c1, c2=c2,
        bar1=200, bar2=150, bar3=110,
    )
    (OUT / f"{sku.lower()}.svg").write_text(svg, encoding="utf-8")
    made += 1

print(f"{made} imágenes generadas en {OUT}")
