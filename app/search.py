from __future__ import annotations

import json
from typing import Any

from app.memory.service import memory_service
from app.neurons import build_neuron_graph
from app.vault.service import vault_service


def _normalize_query(query: str) -> str:
    return query.strip().lower()


def _matches(haystack: str, query: str) -> bool:
    if not query:
        return False
    h = haystack.lower()
    if query in h:
        return True
    parts = [p for p in query.split() if len(p) >= 2]
    return bool(parts) and all(p in h for p in parts)


def _exact_id_match(query: str, candidate: str) -> bool:
    raw = query.strip()
    if not raw or not candidate:
        return False
    c = candidate.strip()
    return raw.lower() == c.lower()


def _vault_result(note: dict[str, Any], neuron_id: str) -> dict[str, Any]:
    return {
        "kind": "vault_note",
        "id": neuron_id,
        "memory_id": None,
        "vault_path": note["path"],
        "label": note.get("title") or note["path"],
        "preview": (note.get("preview") or "")[:160],
        "type": "note",
        "importance": None,
        "created_at": note.get("modified_at"),
    }


def _memory_result(mem: dict[str, Any], neuron_id: str) -> dict[str, Any]:
    meta = mem.get("metadata") or {}
    preview = (mem.get("text") or "")[:160]
    return {
        "kind": "memory",
        "id": neuron_id,
        "memory_id": mem["id"],
        "vault_path": meta.get("vault_note_path"),
        "label": preview[:48] or mem["id"],
        "preview": preview,
        "type": mem.get("type", "conversation"),
        "importance": mem.get("importance"),
        "created_at": mem.get("created_at"),
    }


def search_brain(query: str, limit: int = 40) -> list[dict[str, Any]]:
    raw_query = query.strip()
    q = _normalize_query(raw_query)
    if not q:
        return []

    results: list[dict[str, Any]] = []
    seen: set[str] = set()

    def add(item: dict[str, Any]) -> None:
        if item["id"] in seen:
            return
        seen.add(item["id"])
        results.append(item)

    # Coincidencia exacta de ID (p. ej. vault_Process_chat-2026-06-25_2249)
    for mem in memory_service.list_all():
        memory_id = mem["id"]
        neuron_id = f"memory_{memory_id}"
        if _exact_id_match(raw_query, memory_id) or _exact_id_match(raw_query, neuron_id):
            add(_memory_result(mem, neuron_id))

    try:
        vault_service.ensure_vault()
        for note in vault_service.list_notes():
            neuron_id = vault_service.neuron_id_for_path(note["path"])
            path = note.get("path") or ""
            stem = path.replace(".md", "").split("/")[-1]
            if (
                _exact_id_match(raw_query, neuron_id)
                or _exact_id_match(raw_query, path)
                or _exact_id_match(raw_query, stem)
            ):
                add(_vault_result(note, neuron_id))
    except Exception:
        pass

    for item in list(results):
        if item["kind"] == "memory" and item.get("vault_path"):
            path = item["vault_path"]
            try:
                for note in vault_service.list_notes():
                    if note["path"] == path:
                        nid = vault_service.neuron_id_for_path(path)
                        if _exact_id_match(raw_query, nid):
                            add(_vault_result(note, nid))
                        break
            except Exception:
                pass

    # Búsqueda parcial
    for mem in memory_service.list_all():
        memory_id = mem["id"]
        neuron_id = f"memory_{memory_id}"
        if neuron_id in seen:
            continue
        meta = mem.get("metadata") or {}
        haystack = " ".join(
            [
                memory_id,
                neuron_id,
                mem.get("text") or "",
                mem.get("type") or "",
                json.dumps(meta, ensure_ascii=False),
            ]
        )
        if not _matches(haystack, q):
            continue
        add(_memory_result(mem, neuron_id))

    try:
        vault_service.ensure_vault()
        for note in vault_service.list_notes():
            neuron_id = vault_service.neuron_id_for_path(note["path"])
            if neuron_id in seen:
                continue
            haystack = " ".join(
                [
                    neuron_id,
                    note.get("path") or "",
                    note.get("title") or "",
                    note.get("preview") or "",
                ]
            )
            if not _matches(haystack, q):
                continue
            add(_vault_result(note, neuron_id))
    except Exception:
        pass

    try:
        for neuron in build_neuron_graph():
            if neuron.id in seen:
                continue
            if not (neuron.id.startswith("repo_") or neuron.id.startswith("workflow_")):
                continue
            if _exact_id_match(raw_query, neuron.id):
                add(
                    {
                        "kind": "neuron",
                        "id": neuron.id,
                        "memory_id": None,
                        "vault_path": neuron.ref_path,
                        "label": neuron.label or neuron.id,
                        "preview": (neuron.content_preview or "")[:160],
                        "type": neuron.type,
                        "importance": neuron.importance,
                        "created_at": neuron.created_at,
                    }
                )
                continue
            haystack = " ".join(
                [
                    neuron.id,
                    neuron.label or "",
                    neuron.content_preview or "",
                    neuron.type or "",
                ]
            )
            if not _matches(haystack, q):
                continue
            add(
                {
                    "kind": "neuron",
                    "id": neuron.id,
                    "memory_id": None,
                    "vault_path": neuron.ref_path,
                    "label": neuron.label or neuron.id,
                    "preview": (neuron.content_preview or "")[:160],
                    "type": neuron.type,
                    "importance": neuron.importance,
                    "created_at": neuron.created_at,
                }
            )
    except Exception:
        pass

    return results[:limit]
