"""Create a source-only sharing ZIP and standalone PDF using Python's stdlib."""
from pathlib import Path
from datetime import datetime
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS = Path.home() / "Downloads"
DIRECTORIES = ("app", "components", "db", "docs", "drizzle", "hooks", "lib", "public", "scripts", "tests", "vendor", "worker")
ROOT_FILES = (".gitignore", ".npmrc", "cloudflare-env.d.ts", "components.json", "drizzle.config.ts", "eslint.config.mjs", "next-env.d.ts", "next.config.ts", "package-lock.json", "package.json", "postcss.config.mjs", "README.md", "LEEME-PARA-COMPARTIR.md", "tsconfig.json", "vite.config.ts")
EXCLUDED_DIRS = {"node_modules", ".git", ".next", ".vinext", ".wrangler", ".sites-runtime", "dist", "work", "outputs", "__pycache__"}
PDF_NAME = "Guia-PMCC-Call-Ratio-Desde-Cero.pdf"
DATE = datetime.now().strftime("%Y-%m-%d")

def unique(name):
    path = DOWNLOADS / name
    if path.exists():
        path = path.with_stem(path.stem + "-" + datetime.now().strftime("%H%M%S%f"))
    return path

def allowed(path):
    rel = path.relative_to(ROOT)
    lower = path.name.lower()
    return not (path.is_symlink() or any(p in EXCLUDED_DIRS for p in rel.parts)
                or lower.startswith(".env") or lower.startswith(".dev.vars")
                or path.suffix.lower() in {".key", ".pem", ".sqlite", ".db", ".pyc", ".tsbuildinfo"})

def main():
    DOWNLOADS.mkdir(exist_ok=True)
    pdf = ROOT / "docs" / PDF_NAME
    data = pdf.read_bytes()
    assert data.startswith(b"%PDF-"), "Generate the PDF first."
    files = [ROOT / name for name in ROOT_FILES]
    for directory in DIRECTORIES:
        files.extend(p for p in (ROOT / directory).rglob("*") if p.is_file() and allowed(p))
    assert all(p.is_file() for p in files)
    assert ROOT / "lib" / "cycle-simulator.ts" in files
    archive = unique(f"TEPIC-Proyecto-Para-Compartir-{DATE}.zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9, strict_timestamps=False) as out:
        for file in sorted(set(files)):
            out.write(file, "tepic-terminal/" + file.relative_to(ROOT).as_posix())
        # Keep the config import required by Vite without the original hosting identity.
        out.writestr("tepic-terminal/.openai/hosting.json", json.dumps({"d1": None, "r2": None, "project_id": "compartido-local"}, indent=2) + "\n")
        out.writestr("tepic-terminal/ENTREGA-INFO.txt", "Proyecto educativo TEPIC. Empieza por LEEME-PARA-COMPARTIR.md.\nSe omiten dependencias instaladas, cachés, credenciales y datos locales.\n")
    with zipfile.ZipFile(archive) as check:
        assert check.testzip() is None, "Archive CRC failure."
        names = check.namelist()
        assert all(not n.startswith("/") and ".." not in Path(n).parts for n in names)
        assert all(not any(part in EXCLUDED_DIRS for part in Path(n).parts) for n in names)
        assert check.read("tepic-terminal/docs/" + PDF_NAME) == data
        assert json.loads(check.read("tepic-terminal/.openai/hosting.json"))["project_id"] == "compartido-local"
        assert "tepic-terminal/LEEME-PARA-COMPARTIR.md" in names
        assert "tepic-terminal/package-lock.json" in names
    standalone = unique(f"Guia-PMCC-Call-Ratio-Desde-Cero-{DATE}.pdf")
    with standalone.open("xb") as out:
        out.write(data)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = archive.with_suffix(".sha256.txt")
    with checksum.open("x", encoding="utf-8") as out:
        out.write(f"{digest}  {archive.name}\n")
    print(json.dumps({"pdf": str(standalone), "pdf_bytes": len(data), "zip": str(archive), "zip_bytes": archive.stat().st_size, "files": len(names), "sha256": digest, "checksum": str(checksum)}, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
