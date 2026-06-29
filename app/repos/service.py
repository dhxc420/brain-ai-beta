from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings
from app.memory.embeddings import ollama_embeddings_ready
from app.memory.service import memory_service
from app.repos.transcripts import find_parent_transcripts, parse_transcript_file, turns_to_memories

# Import masivo: timeout corto por embedding; si Ollama no responde, hash local (sin bloquear minutos).
BULK_EMBED_TIMEOUT = 3.0

ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_CONFIG = ROOT / "data" / "repos.json"
STATE_FILE = ROOT / "data" / "repo_import_state.json"


def _load_config() -> list[dict[str, Any]]:
    path = ROOT / settings.repos_config_path
    if not path.is_file():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("repos", [])


def _load_state() -> dict[str, Any]:
    if not STATE_FILE.is_file():
        return {"imported_hashes": [], "last_sync": {}}
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def _save_state(state: dict[str, Any]) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _import_hash(repo_id: str, text: str) -> str:
    return hashlib.sha256(f"v2:{repo_id}:{text[:800]}".encode()).hexdigest()[:20]


class RepoService:
    def list_repos(self) -> list[dict[str, Any]]:
        state = _load_state()
        repos = []
        for repo in _load_config():
            rid = repo["id"]
            sync_info = state.get("last_sync", {}).get(rid, {})
            repos.append(
                {
                    **repo,
                    "neuron_id": f"repo_{rid}",
                    "memory_count": sync_info.get("memory_count", 0),
                    "transcript_files": sync_info.get("transcript_files", 0),
                    "last_sync_at": sync_info.get("at"),
                }
            )
        return repos

    def get_repo(self, repo_id: str) -> dict[str, Any] | None:
        for repo in self.list_repos():
            if repo["id"] == repo_id:
                return repo
        return None

    def build_repo_neuron_content(self, repo: dict[str, Any]) -> tuple[str, str]:
        state = _load_state()
        sync = state.get("last_sync", {}).get(repo["id"], {})
        memories = [
            m
            for m in memory_service.list_all()
            if (m.get("metadata") or {}).get("repo_id") == repo["id"]
        ]
        preview = repo.get("description") or repo["label"]
        lines = [
            f"# Repositorio: {repo['label']}",
            "",
            repo.get("description", ""),
            "",
            f"**Ruta código:** `{repo.get('code_path', '—')}`",
        ]
        if repo.get("url"):
            lines.append(f"**URL:** {repo['url']}")
        lines.extend(
            [
                "",
                f"**Chats importados:** {len(memories)} memorias",
                f"**Archivos transcript:** {sync.get('transcript_files', 0)}",
                f"**Última sync:** {sync.get('at', 'nunca')}",
                "",
                "## Temas recientes (chats Cursor)",
            ]
        )
        for mem in memories[:8]:
            text = (mem.get("text") or "").replace("\n", " ")[:160]
            lines.append(f"- {text}")
        full = "\n".join(lines)
        return preview, full

    def sync_repo(self, repo_id: str, max_memories: int = 80) -> dict[str, Any]:
        repo = self.get_repo(repo_id)
        if not repo:
            raise ValueError(f"Repositorio desconocido: {repo_id}")

        transcript_dir = Path(repo["transcript_dir"])
        files = find_parent_transcripts(transcript_dir)
        state = _load_state()
        imported: set[str] = set(state.get("imported_hashes", []))
        added = 0
        skipped = 0
        embed_timeout = BULK_EMBED_TIMEOUT if ollama_embeddings_ready() else 0.5

        for file_path in files:
            messages = parse_transcript_file(file_path)
            for chunk in turns_to_memories(messages):
                h = _import_hash(repo_id, chunk)
                if h in imported:
                    skipped += 1
                    continue
                if added >= max_memories:
                    break
                memory_service.remember(
                    f"[{repo['label']}] {chunk}",
                    memory_type="source",
                    metadata={
                        "repo_id": repo_id,
                        "repo_label": repo["label"],
                        "source": "cursor_transcript",
                        "transcript_file": str(file_path.name),
                        "import_hash": h,
                    },
                    embed_timeout=embed_timeout,
                )
                imported.add(h)
                added += 1
            if added >= max_memories:
                break

        now = datetime.now(timezone.utc).isoformat()
        total_for_repo = sum(
            1
            for m in memory_service.list_all()
            if (m.get("metadata") or {}).get("repo_id") == repo_id
        )
        state.setdefault("last_sync", {})[repo_id] = {
            "at": now,
            "memory_count": total_for_repo,
            "added": added,
            "skipped": skipped,
            "transcript_files": len(files),
        }
        state["imported_hashes"] = list(imported)[-5000:]
        _save_state(state)
        return {"repo_id": repo_id, "added": added, "skipped": skipped, "files": len(files)}

    def try_expand_memory_text(self, memory: dict[str, Any]) -> str | None:
        """Reconstruye texto completo desde el transcript si la memoria fue importada."""
        meta = memory.get("metadata") or {}
        if meta.get("source") != "cursor_transcript":
            return None
        repo_id = meta.get("repo_id")
        file_name = meta.get("transcript_file")
        if not repo_id or not file_name:
            return None
        repo = self.get_repo(repo_id)
        if not repo:
            return None

        stored = (memory.get("text") or "").strip()
        stored_body = re.sub(r"^\[[^\]]+\]\s*", "", stored, count=1)
        if len(stored_body) < 20:
            return None
        needle = stored_body[:160]

        transcript_dir = Path(repo["transcript_dir"])
        for file_path in find_parent_transcripts(transcript_dir):
            if file_path.name != file_name:
                continue
            messages = parse_transcript_file(file_path)
            for chunk in turns_to_memories(messages):
                if needle in chunk or chunk[:160] in stored_body:
                    label = meta.get("repo_label") or repo.get("label") or repo_id
                    return f"[{label}] {chunk}"
        return None

    def sync_all(self) -> dict[str, Any]:
        results = []
        for repo in _load_config():
            try:
                results.append(self.sync_repo(repo["id"]))
            except Exception as exc:
                results.append({"repo_id": repo["id"], "error": str(exc)})
        return {"repos": results}


repo_service = RepoService()
