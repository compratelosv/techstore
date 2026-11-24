"""Estampa un hash de versión en las referencias a JS/CSS.

Problema que resuelve: GitHub Pages sirve los assets con `max-age=600`. Tras un
deploy, el navegador puede tener el HTML nuevo (con un botón nuevo) y el JS
viejo (sin la acción), y el botón "no hace nada" sin ningún error.

Solución: reescribir cada referencia `js/x.js` / `css/x.css` añadiendo
`?v=<hash del contenido>`. Si el archivo cambia, cambia su URL y el navegador
no puede reutilizar la copia anterior. También versiona los imports internos
entre módulos (`from './x.js'`).

Uso:  python tools/stamp_assets.py
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSET_DIRS = ["js", "css"]

VERSION_RE = re.compile(r"\?v=[0-9a-f]{6,}")


def digest(path: Path) -> str:
    # Se hashea el contenido sin marcas de versión: así el hash depende del
    # código real y no de la pasada anterior (script idempotente).
    text = clean(path.read_text(encoding="utf-8"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]


def clean(text: str) -> str:
    """Quita ?v=... previos para que el script sea idempotente."""
    return VERSION_RE.sub("", text)


def main() -> None:
    versions = {}
    for d in ASSET_DIRS:
        for f in (ROOT / d).rglob("*"):
            if f.is_file() and f.suffix in {".js", ".css", ".mjs"}:
                versions[f.relative_to(ROOT).as_posix()] = digest(f)

    # 1) imports internos entre módulos JS
    js_changed = 0
    for rel, _ in versions.items():
        if not rel.endswith(".js"):
            continue
        path = ROOT / rel
        text = clean(path.read_text(encoding="utf-8"))
        original = text

        def repl(match: re.Match) -> str:
            spec = match.group(1)
            if not spec.startswith("."):
                return match.group(0)
            target = (path.parent / spec.lstrip("./")).resolve()
            key = target.relative_to(ROOT).as_posix()
            v = versions.get(key)
            return f'from \'{spec}?v={v}\'' if v else match.group(0)

        text = re.sub(r"from '([^']+)'", repl, text)
        if text != original:
            path.write_text(text, encoding="utf-8")
            js_changed += 1

    # 2) referencias en HTML
    html_changed = 0
    for html in ROOT.glob("*.html"):
        text = clean(html.read_text(encoding="utf-8"))
        original = text
        for rel, v in versions.items():
            text = text.replace(f'"{rel}"', f'"{rel}?v={v}"')
        if text != original:
            html.write_text(text, encoding="utf-8")
            html_changed += 1

    print(f"versiones: {len(versions)} archivos")
    print(f"js actualizados: {js_changed} · html actualizados: {html_changed}")
    for rel in sorted(versions)[:4]:
        print(f"  {rel} -> {versions[rel]}")


if __name__ == "__main__":
    main()
