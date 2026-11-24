"""Genera códigos EAN-13 válidos para los productos del seed.

Prefijo 200 = rango de uso interno (no colisiona con códigos comerciales).
Emite el SQL de actualización para aplicarlo por migración.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "db" / "003_seed_catalog.sql"
OUT = ROOT / "db" / "007_barcodes.sql"

SKU = re.compile(r"\('([A-Z]{3}-\d{3})'")


def ean13(base12: str) -> str:
    """Calcula el dígito verificador de un EAN-13 a partir de 12 dígitos."""
    assert len(base12) == 12 and base12.isdigit()
    total = 0
    for i, ch in enumerate(base12):
        total += int(ch) * (1 if i % 2 == 0 else 3)
    return base12 + str((10 - total % 10) % 10)


skus = SKU.findall(SEED.read_text(encoding="utf-8"))
lines = ["-- Códigos de barras EAN-13 por producto (prefijo 200 = uso interno)", ""]
values = []
for i, sku in enumerate(skus, start=1):
    code = ean13(f"200{i:09d}")
    values.append(f"('{sku}','{code}')")

lines.append("update ts_products p set barcode = v.code")
lines.append("from (values")
lines.append(",\n".join(f"  {v}" for v in values))
lines.append(") as v(sku, code)")
lines.append("where p.sku = v.sku;")
lines.append("")

OUT.write_text("\n".join(lines), encoding="utf-8")

print(f"{len(skus)} códigos generados -> {OUT}")
for sku, code in list(zip(skus, [ean13(f'200{i:09d}') for i in range(1, len(skus) + 1)]))[:6]:
    print(f"  {sku} -> {code}")
