from __future__ import annotations



import asyncio
from pathlib import Path

import json
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException

from fastapi.responses import FileResponse, StreamingResponse

from app.static_files import NoCacheStaticFiles

from pydantic import BaseModel, Field



from app.agent import WorkflowRunner

from app.config import settings

from app.memory.consolidate import consolidate_duplicates, forget_stale, run_light_consolidation

from app.memory.service import MEMORY_TYPES, memory_service

from app.models import annotate_models, is_model_allowed

from app.neurons import build_neuron_graph, get_neuron

from app.ollama_client import ModelNotAllowedError, OllamaBusyError, OllamaClient

from app.repos.service import repo_service

from app.search import search_brain

from app.vault import onboarding as vault_onboarding

from app.vault.service import vault_service

from app.workflows import get_workflow, list_workflows

from app.edition import edition_info, feature_enabled



ROOT = Path(__file__).resolve().parent.parent

STATIC_DIR = ROOT / "static"



app = FastAPI(title="Brain AI", version="0.2.0")

app.mount("/static", NoCacheStaticFiles(directory=STATIC_DIR), name="static")



runner = WorkflowRunner()

ollama = OllamaClient()





class ChatTurn(BaseModel):

    role: Literal["user", "assistant"]

    content: str = Field(min_length=1, max_length=12000)





class ChatRequest(BaseModel):

    message: str = Field(min_length=1, max_length=12000)

    model: str | None = None

    workflow_id: str | None = None

    history: list[ChatTurn] = Field(default_factory=list)





class WorkflowRunRequest(BaseModel):

    model: str | None = None





class MemoryCreateRequest(BaseModel):

    text: str = Field(min_length=1)

    type: str = "fact"

    metadata: dict | None = None





class ForgetStaleRequest(BaseModel):

    days: int = Field(default=30, ge=1, le=365)

    min_importance: float = Field(default=0.35, ge=0.0, le=1.0)





class VaultNoteWrite(BaseModel):

    path: str = Field(min_length=1)

    content: str = Field(min_length=1)





class VaultProfileWrite(BaseModel):

    content: str = Field(min_length=1)





class VaultProjectCreate(BaseModel):

    name: str = Field(min_length=1)

    goal: str = ""





class VaultOnboardingAnswer(BaseModel):

    answer: str = Field(min_length=1)





@app.get("/")

async def index() -> FileResponse:

    return FileResponse(

        STATIC_DIR / "index.html",

        headers={"Cache-Control": "no-cache"},

    )





@app.get("/api/health")

async def health() -> dict:

    status = await ollama.health()

    models = status.get("models", [])

    annotated = annotate_models(models)

    allowed = [

        m for m in annotated

        if is_model_allowed(

            m["name"],

            allow_medium=settings.allow_medium_models,

            allow_heavy=settings.allow_heavy_models,

        )

    ]

    default = status.get("default_model") or settings.default_model

    memory_count = len(memory_service.list_all())
    workflow_count = len(list_workflows())

    return {

        "service": "brain-ai",

        "brain_features": {
            "workflow_count": workflow_count,
            "local_dir_list": edition_info()["features"]["local_paths"],
            "chat_history": True,
            "chat_stream": True,
        },

        "edition": edition_info(),

        "ollama": {**status, "models": annotated},

        "allowed_models": allowed,

        "default_model": default,

        "niche": settings.niche,

        "safe_mode": not settings.allow_heavy_models,

        "cpu_only": settings.cpu_only,

        "pattern": "ollama-chat-multi-turn",

        "reference": "F:\\X PUBLISHER AUTOMATIC",

        "warnings": _build_warnings(status),

        "limits": {

            "max_context": settings.max_context,

            "max_tokens": settings.max_tokens,

            "keep_alive_seconds": settings.keep_alive_seconds,

        },

        "memory": {

            "count": memory_count,

            "chroma_path": settings.chroma_path,

            "embed_model": settings.embed_model,

        },

    }





def _build_warnings(status: dict) -> list[str]:

    warnings: list[str] = []

    heavy = status.get("heavy_loaded") or []

    if heavy:

        warnings.append(

            f"VRAM ocupada por modelo pesado ({', '.join(heavy)}). "

            "Cierra Cline/Claude con 14B antes de chatear."

        )

    loaded = status.get("loaded_models") or []

    if len(loaded) > 1:

        warnings.append(

            f"Varios modelos cargados ({', '.join(loaded)}). "

            "Brain AI los liberará antes de cada petición."

        )

    return warnings





def _http_error(exc: Exception) -> HTTPException:

    if isinstance(exc, ModelNotAllowedError):

        return HTTPException(status_code=400, detail=str(exc))

    if isinstance(exc, OllamaBusyError):

        return HTTPException(status_code=429, detail=str(exc))

    return HTTPException(status_code=502, detail=str(exc))





def _require_premium(feature: str) -> None:

    if feature_enabled(feature):

        return

    info = edition_info()

    raise HTTPException(

        status_code=403,

        detail=(

            f"Función «{feature}» solo en Brain AI Premium. "

            f"Edición actual: {info['edition']}. "

            f"Más info: {info.get('upgrade_url', 'docs/PREMIUM.md')}"

        ),

    )





@app.get("/api/workflows")

async def workflows() -> dict:

    return {"workflows": list_workflows()}





@app.post("/api/chat")

async def chat(body: ChatRequest) -> dict:

    try:

        if body.workflow_id == "repo_query":

            _require_premium("repo_query")

        history = [t.model_dump() for t in body.history]

        result = await runner.chat(
            body.message,
            model=body.model,
            workflow_id=body.workflow_id,
            history=history,
        )

        reply: dict = {"reply": result["content"], "model": result["model"]}
        if result.get("web_results"):
            reply["web_results"] = result["web_results"]
        return reply

    except Exception as exc:

        raise _http_error(exc) from exc





@app.post("/api/chat/stream")

async def chat_stream(body: ChatRequest) -> StreamingResponse:

    if body.workflow_id == "repo_query":

        _require_premium("repo_query")

    history = [t.model_dump() for t in body.history]

    async def event_generator():
        try:
            async for event in runner.chat_stream(
                body.message,
                model=body.model,
                workflow_id=body.workflow_id,
                history=history,
            ):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            err = _http_error(exc)
            payload = {"type": "error", "detail": err.detail}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )





@app.post("/api/workflows/{workflow_id}/run")

async def run_workflow(workflow_id: str, body: WorkflowRunRequest) -> dict:

    workflow = get_workflow(workflow_id)

    if not workflow:

        raise HTTPException(status_code=404, detail="Workflow no encontrado")

    if workflow_id == "repo_query":

        _require_premium("repo_query")

    try:

        return await runner.run_workflow(workflow, model=body.model)

    except Exception as exc:

        raise _http_error(exc) from exc





@app.get("/api/memories")

async def list_memories() -> dict:

    return {"memories": memory_service.list_all()}





@app.get("/api/search")

async def search(q: str = "", limit: int = 40) -> dict:
    from app.edition import search_api_limit

    query = (q or "").strip()
    if not query:
        return {"query": "", "results": []}
    cap = search_api_limit()
    if limit < 1 or limit > cap:
        limit = min(40, cap)
    return {"query": query, "results": search_brain(query, limit=limit)}





@app.post("/api/memories")

async def create_memory(body: MemoryCreateRequest, background_tasks: BackgroundTasks) -> dict:

    if body.type not in MEMORY_TYPES:

        raise HTTPException(status_code=400, detail=f"Tipo inválido. Usa: {sorted(MEMORY_TYPES)}")

    meta = dict(body.metadata or {})

    if "importante" in body.text.lower():

        meta["explicit_important"] = True

    memory_id = await memory_service.remember_async(body.text, body.type, meta)

    background_tasks.add_task(run_light_consolidation)
    from app.neurons import invalidate_neuron_cache

    background_tasks.add_task(invalidate_neuron_cache)

    return {"id": memory_id, "ok": True}





@app.get("/api/memories/{memory_id}")
async def get_memory(memory_id: str) -> dict:
    memory = memory_service.get(memory_id)
    if not memory:
        raise HTTPException(status_code=404, detail="Memoria no encontrada")
    expanded = repo_service.try_expand_memory_text(memory)
    if not expanded:
        expanded = vault_service.try_expand_chat_memory(memory)
    if expanded:
        memory = {**memory, "text": expanded}
    return memory


@app.delete("/api/memories/{memory_id}")

async def delete_memory(memory_id: str) -> dict:

    if not memory_service.delete(memory_id):

        raise HTTPException(status_code=404, detail="Memoria no encontrada")

    from app.neurons import invalidate_neuron_cache

    invalidate_neuron_cache()

    return {"ok": True, "id": memory_id}





@app.post("/api/memories/consolidate")

async def consolidate_memories() -> dict:
    _require_premium("memory_consolidate")
    result = consolidate_duplicates()
    return {"ok": True, **result}





@app.post("/api/memories/forget-stale")

async def forget_stale_memories(body: ForgetStaleRequest | None = None) -> dict:
    _require_premium("memory_forget_stale")
    req = body or ForgetStaleRequest()

    result = forget_stale(days=req.days, min_importance=req.min_importance)

    return {"ok": True, **result}





@app.get("/api/neurons")

async def neurons_graph() -> dict:

    graph = build_neuron_graph()

    return {"neurons": [n.to_dict() for n in graph]}





@app.get("/api/neurons/{neuron_id}")

async def neuron_detail(neuron_id: str) -> dict:

    neuron = get_neuron(neuron_id)

    if not neuron:

        raise HTTPException(status_code=404, detail="Neurona no encontrada")

    return neuron.to_dict()





@app.get("/api/vault/notes")

async def vault_list_notes() -> dict:

    return {"notes": vault_service.list_notes()}





@app.get("/api/vault/notes/{note_path:path}")

async def vault_read_note(note_path: str) -> dict:

    try:

        return vault_service.read_note(note_path)

    except FileNotFoundError:

        raise HTTPException(status_code=404, detail="Nota no encontrada")

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))





@app.post("/api/vault/notes")

async def vault_write_note(body: VaultNoteWrite) -> dict:

    try:

        return vault_service.write_note(body.path, body.content)

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e))





@app.delete("/api/vault/notes/{note_path:path}")

async def vault_delete_note(note_path: str) -> dict:

    from app.neurons import invalidate_neuron_cache

    rel = note_path.replace("\\", "/").lstrip("/")

    try:

        result = vault_service.delete_note(rel)

    except ValueError as e:

        raise HTTPException(status_code=400, detail=str(e)) from e

    except FileNotFoundError:

        raise HTTPException(status_code=404, detail="Nota no encontrada") from None

    deleted_memory_ids: list[str] = []

    for mem in memory_service.list_all():

        meta = mem.get("metadata") or {}

        if meta.get("vault_note_path") == result["path"]:

            if memory_service.delete(mem["id"]):

                deleted_memory_ids.append(mem["id"])

    invalidate_neuron_cache()

    return {**result, "deleted_memory_ids": deleted_memory_ids, "ok": True}





@app.get("/api/vault/profile")

async def vault_get_profile() -> dict:

    return vault_service.get_profile()





@app.post("/api/vault/profile")

async def vault_save_profile(body: VaultProfileWrite) -> dict:

    return vault_service.save_profile(body.content)





@app.post("/api/vault/projects")

async def vault_create_project(body: VaultProjectCreate) -> dict:

    return vault_service.create_project(body.name, body.goal)





@app.get("/api/vault/onboarding/status")

async def vault_onboarding_status() -> dict:

    return vault_onboarding.onboarding_status()





@app.post("/api/vault/onboarding/start")

async def vault_onboarding_start() -> dict:

    return vault_onboarding.start_onboarding()





@app.post("/api/vault/onboarding/answer")

async def vault_onboarding_answer(body: VaultOnboardingAnswer) -> dict:

    return vault_onboarding.answer_onboarding(body.answer)





@app.post("/api/vault/maintain")

async def vault_maintain() -> dict:

    return vault_service.maintain()





@app.get("/api/vault/graph")

async def vault_graph() -> dict:

    return vault_service.graph()





@app.get("/api/repos")

async def list_repos() -> dict:

    if not feature_enabled("repos_panel"):

        return {"repos": [], "premium_required": True}

    return {"repos": repo_service.list_repos()}





@app.get("/api/repos/{repo_id}")

async def get_repo(repo_id: str) -> dict:

    _require_premium("repos_panel")

    repo = repo_service.get_repo(repo_id)
    if not repo:
        raise HTTPException(status_code=404, detail="Repositorio no encontrado")
    preview, full = repo_service.build_repo_neuron_content(repo)
    return {**repo, "content_preview": preview, "full_content": full}





@app.post("/api/repos/sync")

async def sync_all_repos() -> dict:

    _require_premium("repo_sync")

    from app.neurons import invalidate_neuron_cache

    result = await asyncio.to_thread(repo_service.sync_all)
    invalidate_neuron_cache()
    return result





@app.post("/api/repos/{repo_id}/sync")

async def sync_repo(repo_id: str) -> dict:

    _require_premium("repo_sync")

    from app.neurons import invalidate_neuron_cache

    try:
        result = await asyncio.to_thread(repo_service.sync_repo, repo_id)
        invalidate_neuron_cache()
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

