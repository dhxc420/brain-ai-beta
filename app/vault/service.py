from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings

WIKILINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]")
ROOT = Path(__file__).resolve().parent.parent.parent


def vault_root() -> Path:
    p = ROOT / settings.vault_path
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_path(rel: str) -> Path:
    rel = rel.replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        raise ValueError("Ruta inválida")
    root = vault_root()
    target = (root / rel).resolve()
    if not str(target).startswith(str(root.resolve())):
        raise ValueError("Ruta fuera del vault")
    return target


def parse_wikilinks(content: str) -> list[str]:
    links: list[str] = []
    for match in WIKILINK_RE.finditer(content):
        target = (match.group(1) or "").strip()
        if target and target not in links:
            links.append(target)
    return links


def _note_path_for_link(name: str) -> str | None:
    root = vault_root()
    candidates = [
        f"{name}.md",
        f"{name}/README.md",
        name if name.endswith(".md") else None,
    ]
    for c in candidates:
        if not c:
            continue
        p = root / c.replace("\\", "/")
        if p.is_file():
            return c.replace("\\", "/")
    for p in root.rglob("*.md"):
        if p.stem.lower() == name.lower():
            return str(p.relative_to(root)).replace("\\", "/")
    return None


def _slug(path: str) -> str:
    return path.replace("/", "_").replace(".md", "").replace(" ", "-")


class VaultService:
    PROFILE_FILE = "BRAIN.md"

    def ensure_vault(self) -> None:
        root = vault_root()
        (root / "projects").mkdir(exist_ok=True)
        if not (root / self.PROFILE_FILE).exists():
            (root / self.PROFILE_FILE).write_text(
                "# BRAIN — Perfil\n\n"
                "> Completa el onboarding para cargar tu contexto automáticamente.\n\n"
                "## Quién soy\n\n(pendiente)\n",
                encoding="utf-8",
            )
        if not (root / "goals.md").exists():
            (root / "goals.md").write_text(
                "# Objetivos\n\n- [[BRAIN]]\n",
                encoding="utf-8",
            )

    def list_notes(self) -> list[dict[str, Any]]:
        self.ensure_vault()
        root = vault_root()
        notes: list[dict[str, Any]] = []
        for p in sorted(root.rglob("*.md")):
            rel = str(p.relative_to(root)).replace("\\", "/")
            stat = p.stat()
            content = p.read_text(encoding="utf-8", errors="replace")
            links = parse_wikilinks(content)
            notes.append(
                {
                    "path": rel,
                    "title": p.stem,
                    "preview": content.replace("\n", " ")[:120],
                    "links": links,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "folder": str(Path(rel).parent).replace("\\", "/") if "/" in rel else "",
                }
            )
        return notes

    def read_note(self, rel_path: str) -> dict[str, Any]:
        path = _safe_path(rel_path)
        if not path.is_file():
            raise FileNotFoundError(rel_path)
        content = path.read_text(encoding="utf-8", errors="replace")
        root = vault_root()
        rel = str(path.relative_to(root)).replace("\\", "/")
        backlinks: list[str] = []
        for other in root.rglob("*.md"):
            orel = str(other.relative_to(root)).replace("\\", "/")
            if orel == rel:
                continue
            if rel_path.removesuffix(".md") in parse_wikilinks(other.read_text(encoding="utf-8", errors="replace")):
                backlinks.append(orel)
            stem = Path(rel_path).stem
            if stem in parse_wikilinks(other.read_text(encoding="utf-8", errors="replace")):
                if orel not in backlinks:
                    backlinks.append(orel)
        return {
            "path": rel,
            "title": path.stem,
            "content": content,
            "links": parse_wikilinks(content),
            "backlinks": backlinks,
            "modified_at": datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat(),
        }

    def write_note(self, rel_path: str, content: str) -> dict[str, Any]:
        if not rel_path.endswith(".md"):
            rel_path += ".md"
        path = _safe_path(rel_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return self.read_note(rel_path)

    def delete_note(self, rel_path: str) -> dict[str, Any]:
        rel_path = rel_path.replace("\\", "/").lstrip("/")
        if not rel_path.endswith(".md"):
            rel_path += ".md"
        path = _safe_path(rel_path)
        if not path.is_file():
            raise FileNotFoundError(rel_path)
        path.unlink()
        return {"path": rel_path, "deleted": True}

    def get_profile(self) -> dict[str, Any]:
        self.ensure_vault()
        path = vault_root() / self.PROFILE_FILE
        content = path.read_text(encoding="utf-8", errors="replace")
        return {"path": self.PROFILE_FILE, "content": content, "exists": True}

    def save_profile(self, content: str) -> dict[str, Any]:
        return self.write_note(self.PROFILE_FILE, content)

    def profile_for_prompt(self, max_chars: int = 2500) -> str:
        try:
            content = self.get_profile()["content"]
            if len(content) > max_chars:
                content = content[: max_chars - 20] + "\n\n...(truncado)"
            return f"## Perfil del usuario (BRAIN.md)\n{content}"
        except Exception:
            return ""

    def create_project(self, name: str, goal: str = "") -> dict[str, Any]:
        slug = re.sub(r"[^\w\-]", "-", name.lower()).strip("-")
        base = vault_root() / "projects" / slug
        for folder in ("Inputs", "Process", "Outputs", "Feedback", "skills"):
            (base / folder).mkdir(parents=True, exist_ok=True)
        project_md = (
            f"# Proyecto: {name}\n\n"
            f"## Objetivo\n{goal or '(definir)'}\n\n"
            f"## Pipeline\n"
            f"- **Inputs** — ideas y materia prima\n"
            f"- **Process** — trabajo en curso\n"
            f"- **Outputs** — entregables\n"
            f"- **Feedback** — métricas y aprendizajes\n\n"
            f"Enlaces: [[BRAIN]] [[goals]]\n"
        )
        (base / "CLAUDE.md").write_text(project_md, encoding="utf-8")
        (base / "Inputs" / "inbox.md").write_text(
            f"# Inbox — {name}\n\nNotas sin clasificar. El mantenimiento diario las archiva.\n",
            encoding="utf-8",
        )
        return {"slug": slug, "path": f"projects/{slug}", "folders": ["Inputs", "Process", "Outputs", "Feedback", "skills"]}

    def save_chat_note(self, user_msg: str, assistant_msg: str, tags: list[str] | None = None) -> dict[str, Any]:
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d_%H%M")
        links = " ".join(f"[[{t}]]" for t in (tags or ["BRAIN"]))
        body = (
            f"# Chat {now}\n\n"
            f"Enlaces: {links}\n\n"
            f"## Usuario\n{user_msg}\n\n"
            f"## Brain AI\n{assistant_msg}\n"
        )
        rel = f"Process/chat-{now}.md"
        return self.write_note(rel, body)

    def try_expand_chat_memory(self, memory: dict[str, Any]) -> str | None:
        """Recupera el chat completo desde la nota vault vinculada o por búsqueda."""
        meta = memory.get("metadata") or {}
        path = meta.get("vault_note_path")
        if path:
            try:
                return self.read_note(path)["content"]
            except Exception:
                pass

        stored = (memory.get("text") or "").strip()
        user_snippet = (meta.get("user_message_preview") or "").strip()
        if not user_snippet and stored.startswith("Usuario:"):
            user_snippet = stored.split("\n", 1)[0].replace("Usuario:", "").strip()
        elif not user_snippet and "## Usuario" in stored:
            part = stored.split("## Usuario", 1)[-1]
            user_snippet = part.split("##", 1)[0].strip()[:120]
        if not user_snippet:
            return None

        needle = user_snippet[:100]
        process = vault_root() / "Process"
        if not process.is_dir():
            return None
        for note_path in sorted(process.glob("chat-*.md"), reverse=True):
            try:
                content = note_path.read_text(encoding="utf-8", errors="replace")
                if needle in content:
                    return content
            except Exception:
                continue
        return None

    def graph(self) -> dict[str, Any]:
        notes = self.list_notes()
        nodes = [{"id": f"vault_{_slug(n['path'])}", "path": n["path"], "title": n["title"]} for n in notes]
        edges: list[dict[str, str]] = []
        path_to_id = {n["path"]: f"vault_{_slug(n['path'])}" for n in notes}
        stem_to_path = {Path(n["path"]).stem: n["path"] for n in notes}
        for note in notes:
            src = path_to_id[note["path"]]
            for link in note["links"]:
                tgt_path = stem_to_path.get(link) or _note_path_for_link(link)
                if tgt_path and tgt_path in path_to_id:
                    edges.append({"from": src, "to": path_to_id[tgt_path], "label": link})
        return {"nodes": nodes, "edges": edges, "note_count": len(notes)}

    def maintain(self, stale_days: int = 30) -> dict[str, Any]:
        self.ensure_vault()
        root = vault_root()
        now = datetime.now(timezone.utc)
        stale: list[str] = []
        inbox_items: list[str] = []
        filed = 0

        for p in root.rglob("*.md"):
            rel = str(p.relative_to(root)).replace("\\", "/")
            age_days = (now - datetime.fromtimestamp(p.stat().st_mtime, tz=timezone.utc)).days
            if age_days >= stale_days and "Inputs" not in rel:
                stale.append(rel)
            if "/Inputs/" in rel.replace("\\", "/") and p.stat().st_size > 80:
                inbox_items.append(rel)

        summary_lines = [
            f"Vault: {len(list(root.rglob('*.md')))} notas",
            f"Inbox pendiente: {len(inbox_items)} en Inputs/",
            f"Notas stale (>{stale_days}d): {len(stale)}",
        ]
        if stale[:5]:
            summary_lines.append("Stale: " + ", ".join(stale[:5]))
        return {
            "summary": "\n".join(summary_lines),
            "stale": stale,
            "inbox": inbox_items,
            "filed": filed,
        }

    def neuron_id_for_path(self, path: str) -> str:
        return f"vault_{_slug(path)}"


vault_service = VaultService()
