from __future__ import annotations

import asyncio
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.memory.embeddings import embed_text_sync
from app.memory.store import get_collection

MEMORY_TYPES = frozenset({"fact", "conversation", "workflow_run", "source"})

_EXTRACT_PATTERNS: list[tuple[re.Pattern[str], int]] = [
    (re.compile(r"(?:recuerda|remember)\s+que\s+(.+)", re.I | re.S), 1),
    (re.compile(r"(?:recuerda|remember)\s*[:,-]\s*(.+)", re.I | re.S), 1),
    (re.compile(r"(?:my name is|me llamo|soy)\s+(.+?)(?:\.|$)", re.I), 1),
    (re.compile(r"(?:importante|important)\s*[:,-]\s*(.+)", re.I | re.S), 1),
    (re.compile(r"(?:no olvides|don't forget)\s+(?:que\s+)?(.+)", re.I | re.S), 1),
]


def extract_facts_from_message(text: str) -> list[dict[str, Any]]:
    """Detecta hechos explícitos en mensajes del usuario."""
    facts: list[dict[str, Any]] = []
    stripped = text.strip()
    if not stripped:
        return facts

    for pattern, group in _EXTRACT_PATTERNS:
        match = pattern.search(stripped)
        if match:
            fact_text = match.group(group).strip()
            if len(fact_text) >= 3:
                facts.append(
                    {
                        "text": fact_text,
                        "type": "fact",
                        "metadata": {"source": "auto_extract", "original": stripped[:200]},
                        "importance_boost": 0.3,
                    }
                )

    if re.search(r"\bimportante\b", stripped, re.I):
        for fact in facts:
            fact["importance_boost"] = max(fact.get("importance_boost", 0), 0.5)

    return facts


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _compute_importance(
    text: str,
    memory_type: str,
    metadata: dict[str, Any] | None = None,
) -> float:
    meta = metadata or {}
    score = 0.4
    if memory_type == "fact":
        score = 0.7
    elif memory_type == "workflow_run":
        score = 0.5
    elif memory_type == "source":
        score = 0.45

    if meta.get("explicit_important") or meta.get("user_marked_important"):
        score = min(1.0, score + 0.35)

    recall_count = int(meta.get("recall_count") or 0)
    score = min(1.0, score + recall_count * 0.05)

    importance_boost = float(meta.get("importance_boost") or 0)
    score = min(1.0, score + importance_boost)

    if re.search(r"\bimportante\b", text, re.I):
        score = min(1.0, score + 0.2)

    return round(score, 3)


class MemoryService:
    def remember(
        self,
        text: str,
        memory_type: str = "conversation",
        metadata: dict[str, Any] | None = None,
        *,
        embed_timeout: float | None = None,
    ) -> str:
        if memory_type not in MEMORY_TYPES:
            raise ValueError(f"Tipo inválido: {memory_type}")

        memory_id = str(uuid.uuid4())
        meta = dict(metadata or {})
        meta.setdefault("type", memory_type)
        meta.setdefault("created_at", _now_iso())
        meta.setdefault("recall_count", 0)
        meta["importance"] = _compute_importance(text, memory_type, meta)

        if embed_timeout is not None:
            embedding = embed_text_sync(text, timeout=embed_timeout)
        else:
            embedding = embed_text_sync(text)
        collection = get_collection()
        collection.add(
            ids=[memory_id],
            documents=[text],
            embeddings=[embedding],
            metadatas=[{k: _serialize_meta(v) for k, v in meta.items()}],
        )
        return memory_id

    def recall(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        if not query.strip():
            return []

        collection = get_collection()
        if collection.count() == 0:
            return []

        embedding = embed_text_sync(query)
        results = collection.query(
            query_embeddings=[embedding],
            n_results=min(limit, max(collection.count(), 1)),
            include=["documents", "metadatas", "distances"],
        )

        memories: list[dict[str, Any]] = []
        ids = results.get("ids", [[]])[0]
        docs = results.get("documents", [[]])[0]
        metas = results.get("metadatas", [[]])[0]
        dists = results.get("distances", [[]])[0]

        for memory_id, doc, meta, dist in zip(ids, docs, metas, dists):
            meta = meta or {}
            memories.append(
                {
                    "id": memory_id,
                    "text": doc,
                    "type": meta.get("type", "conversation"),
                    "metadata": _deserialize_meta(meta),
                    "distance": dist,
                    "importance": float(meta.get("importance") or 0.5),
                }
            )
            self._bump_recall_count(memory_id, meta)

        return memories

    def _bump_recall_count(self, memory_id: str, meta: dict) -> None:
        try:
            count = int(meta.get("recall_count") or 0) + 1
            importance = min(1.0, float(meta.get("importance") or 0.5) + 0.02)
            collection = get_collection()
            collection.update(
                ids=[memory_id],
                metadatas=[
                    {
                        **meta,
                        "recall_count": count,
                        "importance": importance,
                        "last_recalled_at": _now_iso(),
                    }
                ],
            )
        except Exception:
            pass

    def list_all(self) -> list[dict[str, Any]]:
        collection = get_collection()
        if collection.count() == 0:
            return []

        data = collection.get(include=["documents", "metadatas"])
        memories: list[dict[str, Any]] = []
        for memory_id, doc, meta in zip(
            data.get("ids", []),
            data.get("documents", []),
            data.get("metadatas", []),
        ):
            meta = meta or {}
            memories.append(
                {
                    "id": memory_id,
                    "text": doc,
                    "type": meta.get("type", "conversation"),
                    "metadata": _deserialize_meta(meta),
                    "importance": float(meta.get("importance") or 0.5),
                    "created_at": meta.get("created_at"),
                }
            )
        memories.sort(
            key=lambda m: m.get("created_at") or "",
            reverse=True,
        )
        return memories

    def get(self, memory_id: str) -> dict[str, Any] | None:
        collection = get_collection()
        try:
            data = collection.get(
                ids=[memory_id],
                include=["documents", "metadatas"],
            )
        except Exception:
            return None
        ids = data.get("ids") or []
        if not ids:
            return None
        doc = (data.get("documents") or [""])[0]
        meta = (data.get("metadatas") or [{}])[0] or {}
        return {
            "id": memory_id,
            "text": doc,
            "type": meta.get("type", "conversation"),
            "metadata": _deserialize_meta(meta),
            "importance": float(meta.get("importance") or 0.5),
            "created_at": meta.get("created_at"),
        }

    def delete(self, memory_id: str) -> bool:
        collection = get_collection()
        existing = collection.get(ids=[memory_id])
        if not existing.get("ids"):
            return False
        collection.delete(ids=[memory_id])
        return True

    def delete_many(self, memory_ids: list[str]) -> int:
        if not memory_ids:
            return 0
        collection = get_collection()
        collection.delete(ids=memory_ids)
        return len(memory_ids)

    async def remember_async(
        self,
        text: str,
        memory_type: str = "conversation",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        return await asyncio.to_thread(self.remember, text, memory_type, metadata)

    async def recall_async(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        return await asyncio.to_thread(self.recall, query, limit)

    def format_for_prompt(self, memories: list[dict[str, Any]]) -> str:
        if not memories:
            return ""
        lines = ["Memorias relevantes del usuario:"]
        for i, mem in enumerate(memories, 1):
            mtype = mem.get("type", "conversation")
            lines.append(f"{i}. [{mtype}] {mem.get('text', '')}")
        return "\n".join(lines)


def _serialize_meta(value: Any) -> str | int | float | bool:
    if isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


def _deserialize_meta(meta: dict) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in meta.items():
        if k == "recall_count":
            try:
                out[k] = int(v)
            except (TypeError, ValueError):
                out[k] = 0
        elif k == "importance":
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                out[k] = 0.5
        else:
            out[k] = v
    return out


memory_service = MemoryService()
