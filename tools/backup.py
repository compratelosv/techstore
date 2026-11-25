"""backup.py — respaldo logico de la base y subida a Google Drive.

Uso:
  python tools/backup.py             # backup manual
  python tools/backup.py --trigger programado

Hace: exporta todas las tablas por API REST, comprime, sube a
Drive en <carpeta>/AAAA/MM/, registra el resultado en ts_backup_runs
y borra las copias que superen la retencion.
"""
import io, json, os, re, subprocess, sys, urllib.request, zipfile
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = Path(os.path.expanduser("~")) / "AppData/Local/hermes/profiles/mysoftware/.env"


def env_value(key):
    txt = ENV.read_text(encoding="utf-8")
    m = re.search(rf"^{key}=(.+)$", txt, re.M)
    return m.group(1).strip().strip('"').strip("'") if m else None


cfg = (ROOT / "js/config.js").read_text(encoding="utf-8")
URL = re.search(r"SUPABASE_URL:\s*'([^']+)'", cfg).group(1)
ANON = re.search(r"SUPABASE_ANON_KEY:\s*\n?\s*'([^']+)'", cfg).group(1)
EMAIL = env_value("TS_ADMIN_EMAIL")
PASS = env_value("TS_ADMIN_PASS")


def http(path, method="GET", body=None, token=None, extra=None):
    h = {"apikey": ANON, "Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if extra:
        h.update(extra)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(URL + path, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else None
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        raise RuntimeError(f"{e.code} {path} -> {body}") from None


def shell(cmd, cwd=None):
    out = subprocess.run(cmd, capture_output=True, text=True, shell=True, timeout=300, cwd=cwd)
    txt = out.stdout.strip()
    # gws imprime una linea de keyring antes del JSON
    i = txt.find("{")
    return json.loads(txt[i:]) if i >= 0 else {}


def main():
    trigger = "programado" if "--trigger" in sys.argv else "manual"
    token = http("/auth/v1/token?grant_type=password", "POST",
                 {"email": EMAIL, "password": PASS})["access_token"]

    conf = http("/rest/v1/ts_backup_config?id=eq.1&select=*", token=token)[0]
    run_id = http("/rest/v1/ts_backup_runs", "POST", {"trigger": trigger}, token=token,
                  extra={"Prefer": "return=representation"})[0]["id"]

    stamp = datetime.now()
    folder_date = stamp.strftime("%Y/%m")
    name = f"techstore-{stamp:%Y-%m-%d-%H%M}.zip"
    tmp = ROOT.parent / "backups" / name.replace(".zip", "")
    tmp.mkdir(parents=True, exist_ok=True)

    try:
        tables = [r["table_name"] for r in http(
            "/rest/v1/rpc/ts_backup_table_list", "POST", {}, token=token) or []]
    except Exception:
        tables = []
    if not tables:
        # respaldo de la lista conocida si el RPC no existe
        import glob
        last = sorted(glob.glob(str(ROOT.parent / "backups" / "techstore-*" / "_manifest.json")))[-1]
        tables = list(dict.fromkeys(
            x["tabla"] for x in json.loads(Path(last).read_text(encoding="utf-8"))["detalle"]))

    rows_total, manifest, skipped = 0, [], []
    for t in tables:
        rows, off = [], 0
        try:
            while True:
                chunk = http(f"/rest/v1/{t}?select=*", token=token,
                             extra={"Range": f"{off}-{off+999}", "Range-Unit": "items"})
                rows += chunk or []
                if not chunk or len(chunk) < 1000:
                    break
                off += 1000
        except Exception as e:
            skipped.append({"tabla": t, "motivo": str(e)[:80]})
            manifest.append({"tabla": t, "filas": None, "error": "sin permiso de lectura"})
            continue
        (tmp / f"{t}.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1, default=str),
                                       encoding="utf-8")
        rows_total += len(rows)
        manifest.append({"tabla": t, "filas": len(rows)})

    (tmp / "_manifest.json").write_text(json.dumps(
        {"fecha": stamp.isoformat(timespec="seconds"), "tablas": len(tables),
         "filas": rows_total, "detalle": manifest}, ensure_ascii=False, indent=1), encoding="utf-8")

    zip_path = ROOT.parent / "backups" / name
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in tmp.rglob("*.json"):
            z.write(f, f.relative_to(tmp))
    size = zip_path.stat().st_size

    # ---- Drive ----
    root_name = conf["drive_folder"]
    found = shell(f'gws drive files list --params "{{\\"q\\":\\"name=\'{root_name}\' and mimeType=\'application/vnd.google-apps.folder\' and trashed=false\\",\\"fields\\":\\"files(id,name)\\"}}"')
    root_id = (found.get("files") or [{}])[0].get("id")
    if not root_id:
        root_id = shell(f'gws drive files create --json "{{\\"name\\":\\"{root_name}\\",\\"mimeType\\":\\"application/vnd.google-apps.folder\\"}}"').get("id")

    parent = root_id
    for part in folder_date.split("/"):
        q = shell(f'gws drive files list --params "{{\\"q\\":\\"name=\'{part}\' and \'{parent}\' in parents and trashed=false and mimeType=\'application/vnd.google-apps.folder\'\\",\\"fields\\":\\"files(id)\\"}}"')
        pid = (q.get("files") or [{}])[0].get("id")
        if not pid:
            pid = shell(f'gws drive files create --json "{{\\"name\\":\\"{part}\\",\\"parents\\":[\\"{parent}\\"],\\"mimeType\\":\\"application/vnd.google-apps.folder\\"}}"').get("id")
        parent = pid

    up = shell(f'gws drive files create --json "{{\\"name\\":\\"{name}\\",\\"parents\\":[\\"{parent}\\"]}}" --upload "{zip_path}"')
    if not up.get("id"):
        raise RuntimeError(f"Drive no confirmo la subida: {str(up)[:200]}")
    link = up.get("webViewLink") or f"https://drive.google.com/file/d/{up['id']}/view"

    from datetime import datetime as _dt
    http(f"/rest/v1/ts_backup_runs?id=eq.{run_id}", "PATCH", {
        "finished_at": _dt.now().isoformat(), "status": "ok",
        "tables_count": len(tables), "rows_count": rows_total, "bytes": size,
        "file_name": name, "drive_file_id": up.get("id"), "drive_link": link,
    }, token=token, extra={"Prefer": "return=minimal"})
    http("/rest/v1/ts_backup_config?id=eq.1", "PATCH", {
        "last_run_at": _dt.now().isoformat(), "last_status": "ok", "last_error": None,
    }, token=token, extra={"Prefer": "return=minimal"})

    # ---- retencion ----
    cut = (stamp - timedelta(days=int(conf["retention_days"]))).isoformat()
    old = shell(f'gws drive files list --params "{{\\"q\\":\\"\'{root_id}\' in parents and trashed=false and mimeType=\'application/zip\'\\",\\"fields\\":\\"files(id,name,createdTime)\\",\\"pageSize\\":200}}"')
    removed = 0
    for f in old.get("files", []):
        if f.get("createdTime", "") < cut:
            fid = f["id"]
            shell('gws drive files delete --params "{\\"fileId\\":\\"%s\\"}"' % fid)
            removed += 1

    print(json.dumps({"ok": True, "archivo": name, "filas": rows_total, "tablas": len(tables),
                      "bytes": size, "drive": link, "borrados_por_retencion": removed,
                      "sin_permiso": [s["tabla"] for s in skipped]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(json.dumps({"ok": False, "error": str(e)[:300]}, ensure_ascii=False))
        sys.exit(1)
