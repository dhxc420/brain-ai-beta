from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

from app.memory.service import MemoryService, memory_service
from app.memory.store import get_collection
from app.ollama_client import OllamaClient

SIMILARITY_THRESHOLD = 0.12  # cosine distance — lower is more similar


def _as_list(value) -> list[float]:
    if value is None:
        return []
    if hasattr(value, "tolist"):
        return value.tolist()
    return list(value)


def classify_message(text: str, client: OllamaClient | None = None) -> str:
    """Clasifica mensaje con heurísticas; opcionalmente refina con Ollama."""
    low = text.lower().strip()

    if re.search(r"\b(recuerda|remember|me llamo|my name is|importante)\b", low):
        return "fact"
    if re.search(r"\b(fuente|source|url|http|www\.)\b", low):
        return "source"
    if re.search(r"\b(workflow|briefing|digest|ejecut|run)\b", low):
        return "workflow_run"
    if len(text) > 300:
        return "conversation"

    return "conversation"


async def classify_message_async(text: str) -> str:
    base = classify_message(text)
    if base != "conversation":
        return base

    try:
        client = OllamaClient()
        result = await client.generate(
            system=(
                "Clasifica el texto en UNA palabra: fact, conversation, workflow_run, source. "
                "Solo responde esa palabra."
            ),
            user=text[:400],
        )
        label = result.get("content", "").strip().lower()
        if label in {"fact", "conversation", "workflow_run", "source"}:
            return label
    except Exception:
        pass
    return base


def consolidate_duplicates(
    service: MemoryService | None = None,
    threshold: float = SIMILARITY_THRESHOLD,
) -> dict[str, Any]:
    """Fusiona memorias muy similares (menor distancia coseno gana merge)."""
    svc = service or memory_service
    all_memories = svc.list_all()
    if len(all_memories) < 2:
        return {"merged": 0, "deleted_ids": []}

    collection = get_collection()
    data = collection.get(include=["embeddings", "documents", "metadatas"])
    ids = data.get("ids") or []
    embeddings = data.get("embeddings")
    if embeddings is None:
        embeddings = []
    documents = data.get("documents") or []
    metas = data.get("metadatas") or []

    if not ids:
        return {"merged": 0, "deleted_ids": []}

    merged = 0
    deleted_ids: list[str] = []
    seen: set[str] = set()

    for i, id_a in enumerate(ids):
        if id_a in seen:
            continue
        emb_a = _as_list(embeddings[i])
        if not emb_a:
            continue
        for j in range(i + 1, len(ids)):
            id_b = ids[j]
            if id_b in seen:
                continue
            emb_b = _as_list(embeddings[j])
            if not emb_b:
                continue
            dist = _cosine_distance(emb_a, emb_b)
            if dist <= threshold:
                meta_a = metas[i] or {}
                meta_b = metas[j] or {}
                keep_idx, drop_idx = _pick_keep(i, j, meta_a, meta_b, documents)
                keep_id = ids[keep_idx]
                drop_id = ids[drop_idx]
                if drop_id not in seen:
                    seen.add(drop_id)
                    deleted_ids.append(drop_id)
                    merged += 1

    if deleted_ids:
        collection.delete(ids=deleted_ids)

    return {"merged": merged, "deleted_ids": deleted_ids}


def forget_stale(
    days: int = 30,
    min_importance: float = 0.35,
    service: MemoryService | None = None,
) -> dict[str, Any]:
    """Elimina memorias antiguas de baja importancia."""
    svc = service or memory_service
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    to_delete: list[str] = []

    for mem in svc.list_all():
        importance = float(mem.get("importance") or 0.5)
        if importance >= min_importance:
            continue
        created = mem.get("created_at") or mem.get("metadata", {}).get("created_at")
        if not created:
            continue
        try:
            created_dt = datetime.fromisoformat(created.replace("Z", "+00:00"))
        except ValueError:
            continue
        if created_dt < cutoff:
            to_delete.append(mem["id"])

    deleted = svc.delete_many(to_delete)
    return {"deleted": deleted, "deleted_ids": to_delete}


def _cosine_distance(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 1.0
    similarity = dot / (norm_a * norm_b)
    return 1.0 - similarity


def _pick_keep(
    i: int,
    j: int,
    meta_a: dict,
    meta_b: dict,
    documents: list,
) -> tuple[int, int]:
    imp_a = float(meta_a.get("importance") or 0.5)
    imp_b = float(meta_b.get("importance") or 0.5)
    if imp_a >= imp_b:
        return i, j
    if imp_b > imp_a:
        return j, i
    len_a = len(documents[i] or "")
    len_b = len(documents[j] or "")
    return (i, j) if len_a >= len_b else (j, i)


async def run_light_consolidation() -> None:
    """Consolidación ligera en background tras guardar memorias."""
    try:
        consolidate_duplicates()
        forget_stale(days=30)
    except Exception:
        pass
