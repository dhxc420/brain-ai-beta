from __future__ import annotations

import hashlib
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.memory.service import memory_service
from app.repos.service import repo_service
from app.vault.service import vault_service
from app.workflows import WORKFLOWS, Workflow


@dataclass
class Neuron:
    id: str
    label: str
    type: str
    content_preview: str
    full_content: str
    connections: list[str] = field(default_factory=list)
    position_hint: dict[str, float] = field(default_factory=dict)
    importance: float = 0.5
    created_at: str = ""
    ref_path: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _preview(text: str, max_len: int = 80) -> str:
    text = (text or "").replace("\n", " ").strip()
    if len(text) <= max_len:
        return text
    return text[: max_len - 1] + "…"


def _inside_brain_ellipsoid(x: float, y: float, z: float) -> bool:
    """Comprueba si un punto cae dentro del volumen cerebral aproximado."""
    hem = 1.0 if x >= 0 else -1.0
    lx = (x - hem * 0.36) / 0.72
    ly = (y - 0.06) / 0.88
    lz = z / 0.78
    return (lx * lx + ly * ly + lz * lz) <= 1.0


def _brain_interior(
    seed: str,
    importance: float,
    layer: str = "cortex",
    sector: str = "memory",
) -> dict[str, float]:
    """Posición dentro del volumen cerebral — espiral áurea + micro-fractal."""
    h = hashlib.sha256(f"{layer}:{sector}:{seed}".encode()).hexdigest()
    u = int(h[:8], 16) / 0xFFFFFFFF
    v = int(h[8:16], 16) / 0xFFFFFFFF
    w = int(h[16:24], 16) / 0xFFFFFFFF

    golden = math.pi * (3.0 - math.sqrt(5.0))
    idx = int(u * 12000) + 1
    theta = golden * idx
    phi = math.acos(max(-1.0, min(1.0, 1.0 - 2.0 * v)))

    depth = 0.18 + importance * 0.62 + w * 0.14
    depth = min(0.94, max(0.14, depth))
    r = depth * 0.62

    sector_bias = {
        "workflow": (0.22, 0.18, 0.0),
        "repo": (-0.2, 0.12, 0.08),
        "vault": (0.0, -0.12, 0.18),
        "tool": (0.0, -0.22, -0.08),
        "memory": (0.0, 0.0, 0.0),
    }
    bx, by, bz = sector_bias.get(sector, (0.0, 0.0, 0.0))

    hem = 1.0 if math.cos(theta) >= 0 else -1.0
    cx = hem * 0.36 * (0.35 + depth * 0.65)

    x = cx + bx + r * math.sin(phi) * math.cos(theta) * 0.82
    y = 0.06 + by + r * 0.78 * math.cos(phi)
    z = bz + r * math.sin(phi) * math.sin(theta) * 0.72

    h2 = hashlib.sha256(f"fract2:{seed}".encode()).hexdigest()
    f1 = 0.11 * depth
    f2 = 0.055 * depth
    x += f1 * (int(h2[0:4], 16) / 0xFFFF - 0.5)
    y += f1 * (int(h2[4:8], 16) / 0xFFFF - 0.5)
    z += f1 * (int(h2[8:12], 16) / 0xFFFF - 0.5)
    x += f2 * (int(h2[12:16], 16) / 0xFFFF - 0.5) * math.sin(theta * 3.1)
    y += f2 * (int(h2[16:20], 16) / 0xFFFF - 0.5) * math.cos(phi * 2.7)
    z += f2 * (int(h2[20:24], 16) / 0xFFFF - 0.5) * math.sin(phi * 4.3)

    if not _inside_brain_ellipsoid(x, y, z):
        scale = 0.82
        x = cx + (x - cx) * scale
        y = 0.06 + (y - 0.06) * scale
        z = z * scale

    return {"x": round(x, 3), "y": round(y, 3), "z": round(z, 3)}


def _brain_surface(seed: str, importance: float, layer: str = "cortex") -> dict[str, float]:
    """Alias — ahora coloca en el interior, no en la superficie."""
    return _brain_interior(seed, importance, layer, sector="memory")


def _workflow_position(wf: Workflow) -> dict[str, float]:
    """Workflows en lóbulo frontal interno."""
    return _brain_interior(f"workflow:{wf.id}", 0.92, "workflow", sector="workflow")


def _repo_position(repo_id: str, index: int, total: int) -> dict[str, float]:
    """Repos en red temporal interna."""
    imp = 0.82 + (index / max(total, 1)) * 0.12
    return _brain_interior(f"repo:{repo_id}", imp, "repo", sector="repo")


def _tool_neurons() -> list[Neuron]:
    tools = [("tool_web_search", "web_search", "Búsqueda DuckDuckGo", 0.6)]
    neurons: list[Neuron] = []
    for tid, label, desc, imp in tools:
        pos = _brain_interior(tid, imp, "tool", sector="tool")
        neurons.append(
            Neuron(
                id=tid,
                label=label,
                type="tool",
                content_preview=desc,
                full_content=desc,
                connections=["core"],
                position_hint=pos,
                importance=imp,
                created_at=datetime.now(timezone.utc).isoformat(),
            )
        )
    return neurons


_graph_cache: list[Neuron] | None = None


def build_neuron_graph() -> list[Neuron]:
    global _graph_cache
    neurons: dict[str, Neuron] = {}

    neurons["core"] = Neuron(
        id="core",
        label="Núcleo",
        type="memory",
        content_preview="Centro sináptico — workflows y memorias convergen aquí",
        full_content="Núcleo del cerebro Brain AI. Todas las rutas neurales pasan por aquí.",
        connections=[],
        position_hint={"x": 0, "y": 0, "z": 0},
        importance=1.0,
        created_at=datetime.now(timezone.utc).isoformat(),
    )

    for wf in WORKFLOWS.values():
        nid = f"workflow_{wf.id}"
        tool_links = [f"tool_{t}" if not t.startswith("tool_") else f"tool_{t}" for t in wf.tools]
        tool_links = [f"tool_{t}" for t in wf.tools]
        neurons[nid] = Neuron(
            id=nid,
            label=wf.node_label or wf.name,
            type="workflow",
            content_preview=_preview(wf.description),
            full_content=(
                f"{wf.name}\n\n{wf.description}\n\n"
                f"Role: {wf.role}\nTools: {', '.join(wf.tools)}\n"
                f"Trigger: {wf.trigger}\nOutput: {wf.output}"
            ),
            connections=["core", *tool_links],
            position_hint=_workflow_position(wf),
            importance=0.9,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        neurons["core"].connections.append(nid)

    for tool in _tool_neurons():
        neurons[tool.id] = tool
        neurons["core"].connections.append(tool.id)

    memories = memory_service.list_all()
    memory_neurons: list[Neuron] = []

    for mem in memories:
        mem_type = mem.get("type", "conversation")
        type_map = {
            "fact": "memory",
            "conversation": "conversation",
            "workflow_run": "conversation",
            "source": "source",
        }
        neuron_type = type_map.get(mem_type, "memory")
        nid = f"memory_{mem['id']}"
        meta = mem.get("metadata") or {}
        connections = ["core"]
        wf_id = meta.get("workflow_id")
        if wf_id:
            connections.append(f"workflow_{wf_id}")
        repo_id = meta.get("repo_id")
        if repo_id:
            connections.append(f"repo_{repo_id}")

        importance = float(mem.get("importance") or 0.5)
        neuron = Neuron(
            id=nid,
            label=_preview(mem.get("text", ""), 40) or mem_type,
            type=neuron_type,
            content_preview=_preview(mem.get("text", "")),
            full_content=mem.get("text", ""),
            connections=connections,
            position_hint=_brain_interior(mem["id"], importance, "memory", sector="memory"),
            importance=importance,
            created_at=mem.get("created_at") or meta.get("created_at") or "",
        )
        memory_neurons.append(neuron)
        neurons[nid] = neuron

    _link_similar_memories(memory_neurons, neurons)
    _link_workflows_together(neurons)
    _add_vault_neurons(neurons)
    _add_repo_neurons(neurons)

    _graph_cache = list(neurons.values())
    return _graph_cache


def _add_repo_neurons(neurons: dict[str, Neuron]) -> None:
    try:
        repos = repo_service.list_repos()
        total = len(repos)
        for i, repo in enumerate(repos):
            rid = repo["id"]
            nid = f"repo_{rid}"
            preview, full = repo_service.build_repo_neuron_content(repo)
            neurons[nid] = Neuron(
                id=nid,
                label=repo["label"],
                type="repository",
                content_preview=_preview(preview, 90),
                full_content=full,
                connections=["core"],
                position_hint=_repo_position(rid, i, total),
                importance=0.88,
                created_at=repo.get("last_sync_at") or "",
                ref_path=repo.get("code_path") or "",
            )
            if nid not in neurons["core"].connections:
                neurons["core"].connections.append(nid)

            for mem in memory_service.list_all():
                meta = mem.get("metadata") or {}
                if meta.get("repo_id") == rid:
                    mid = f"memory_{mem['id']}"
                    if mid in neurons and nid not in neurons[mid].connections:
                        neurons[mid].connections.append(nid)
                    if mid in neurons and mid not in neurons[nid].connections:
                        neurons[nid].connections.append(mid)
    except Exception:
        pass


def _add_vault_neurons(neurons: dict[str, Neuron]) -> None:
    try:
        vault_service.ensure_vault()
        notes = vault_service.list_notes()
        stem_to_id: dict[str, str] = {}
        for note in notes:
            nid = vault_service.neuron_id_for_path(note["path"])
            stem_to_id[Path(note["path"]).stem] = nid
            is_profile = note["path"] in ("BRAIN.md", "CLAUDE.md")
            neurons[nid] = Neuron(
                id=nid,
                label=note["title"],
                type="note",
                content_preview=_preview(note["preview"]),
                full_content=vault_service.read_note(note["path"])["content"],
                connections=["core"],
                position_hint=_brain_interior(
                    note["path"], 0.75 if is_profile else 0.6, "vault", sector="vault"
                ),
                importance=0.95 if is_profile else 0.65,
                created_at=note.get("modified_at") or "",
                ref_path=note["path"],
            )
            if nid not in neurons["core"].connections:
                neurons["core"].connections.append(nid)

        for note in notes:
            nid = vault_service.neuron_id_for_path(note["path"])
            if nid not in neurons:
                continue
            for link in note["links"]:
                target_id = stem_to_id.get(link)
                if target_id and target_id != nid and target_id not in neurons[nid].connections:
                    neurons[nid].connections.append(target_id)
                if target_id and target_id in neurons and nid not in neurons[target_id].connections:
                    neurons[target_id].connections.append(nid)
    except Exception:
        pass


def _link_similar_memories(
    memory_neurons: list[Neuron],
    neurons: dict[str, Neuron],
    max_links: int = 2,
) -> None:
    for i, a in enumerate(memory_neurons):
        for b in memory_neurons[i + 1 : i + 1 + max_links]:
            if b.id not in a.connections:
                a.connections.append(b.id)
            if a.id not in b.connections:
                b.connections.append(a.id)


def _link_workflows_together(neurons: dict[str, Neuron]) -> None:
    wf_ids = [nid for nid in neurons if nid.startswith("workflow_")]
    for i, wid in enumerate(wf_ids):
        next_wid = wf_ids[(i + 1) % len(wf_ids)]
        if next_wid not in neurons[wid].connections:
            neurons[wid].connections.append(next_wid)


def get_neuron(neuron_id: str) -> Neuron | None:
    graph = _graph_cache if _graph_cache is not None else build_neuron_graph()
    for neuron in graph:
        if neuron.id == neuron_id:
            return neuron
    return None


def invalidate_neuron_cache() -> None:
    global _graph_cache
    _graph_cache = None
