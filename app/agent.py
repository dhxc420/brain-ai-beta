from __future__ import annotations

import asyncio

from app.config import settings
from app.memory.consolidate import classify_message, run_light_consolidation
from app.memory.service import extract_facts_from_message, memory_service
from app.neurons import invalidate_neuron_cache
from app.ollama_client import OllamaClient
from app.tools.web_search import format_results, search_web
from app.vault.service import vault_service
from app.edition import web_search_max_results
from app.workflows import (
    REPO_QUERY_ID,
    WEB_ASK_ID,
    Workflow,
    build_local_path_context,
    build_repo_query_user_context,
    build_system_prompt,
    build_user_context,
    build_web_ask_user_context,
    get_workflow,
    repo_query_wants_web,
    workflow_search_query,
)


class WorkflowRunner:
    def __init__(self, client: OllamaClient | None = None) -> None:
        self.client = client or OllamaClient()

    async def _brain_context(self) -> str:
        parts: list[str] = []
        profile = vault_service.profile_for_prompt()
        if profile:
            parts.append(profile)
        try:
            notes = vault_service.list_notes()
            if notes:
                titles = ", ".join(n["title"] for n in notes[:12])
                parts.append(f"## Notas en vault ({len(notes)})\n{titles}")
        except Exception:
            pass
        return "\n\n".join(parts)

    async def _memory_context(self, query: str) -> str:
        memories = await memory_service.recall_async(query, limit=5)
        return memory_service.format_for_prompt(memories)

    async def _save_auto_facts(self, message: str) -> None:
        for fact in extract_facts_from_message(message):
            meta = dict(fact.get("metadata") or {})
            boost = fact.get("importance_boost")
            if boost:
                meta["importance_boost"] = boost
            await memory_service.remember_async(
                fact["text"],
                memory_type=fact["type"],
                metadata=meta,
            )

    async def _post_save_consolidate(self) -> None:
        async def _delayed() -> None:
            await asyncio.sleep(3.0)
            await run_light_consolidation()

        asyncio.create_task(_delayed())

    async def _repo_query_context(self, message: str | None, web_context: str = "") -> str:
        query = message or "repositorios vault archivos locales"
        memory_block = await self._memory_context(query)
        return build_repo_query_user_context(message, web_context, memory_block)

    async def _web_ask_context(self, message: str | None, web_context: str = "") -> str:
        query = message or "cultura general curiosidades"
        memory_block = await self._memory_context(query)
        return build_web_ask_user_context(message, web_context, memory_block)

    def _trim_history(self, history: list[dict[str, str]] | None) -> list[dict[str, str]]:
        from app.edition import chat_history_limit

        if not history:
            return []
        cleaned: list[dict[str, str]] = []
        for turn in history:
            role = turn.get("role", "")
            content = (turn.get("content") or "").strip()
            if role in ("user", "assistant") and content:
                cleaned.append({"role": role, "content": content})
        max_messages = max(2, chat_history_limit() * 2)
        if len(cleaned) > max_messages:
            cleaned = cleaned[-max_messages:]
        return cleaned

    async def _prepare_chat_messages(
        self,
        message: str,
        history: list[dict[str, str]] | None = None,
        workflow_id: str | None = None,
    ) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
        trimmed = self._trim_history(history)
        wf = get_workflow(workflow_id) if workflow_id else None
        memory_block = await self._memory_context(message)
        brain_block = await self._brain_context()
        web_results: list[dict[str, str]] = []
        web_context = ""

        if wf and wf.id == REPO_QUERY_ID:
            if repo_query_wants_web(message):
                web_results = search_web(message, max_results=web_search_max_results())
                web_context = format_results(web_results)
            user_content = await self._repo_query_context(message, web_context)
            system = build_system_prompt(wf)
            if brain_block:
                system = f"{system}\n\n{brain_block}"
            return (
                [{"role": "system", "content": system}, *trimmed, {"role": "user", "content": user_content}],
                web_results,
            )

        if wf and wf.id == WEB_ASK_ID:
            web_results = search_web(message, max_results=web_search_max_results())
            web_context = format_results(web_results)
            user_content = await self._web_ask_context(message, web_context)
            system = build_system_prompt(wf)
            if brain_block:
                system = f"{system}\n\n{brain_block}"
            return (
                [{"role": "system", "content": system}, *trimmed, {"role": "user", "content": user_content}],
                web_results,
            )

        if wf:
            system = build_system_prompt(wf)
            if brain_block:
                system = f"{system}\n\n{brain_block}"
            if memory_block:
                system = f"{system}\n\n{memory_block}"
            user_content = message
            if "web_search" in wf.tools:
                web_results = search_web(message, max_results=web_search_max_results())
                web_context = format_results(web_results)
                if web_context.strip():
                    user_content = f"{message}\n\n## Contexto web\n{web_context}"
            local_ctx = build_local_path_context(message)
            if local_ctx:
                user_content = f"{user_content}\n\n## Contexto local (sistema)\n{local_ctx}"
            return (
                [{"role": "system", "content": system}, *trimmed, {"role": "user", "content": user_content}],
                web_results,
            )

        system = (
            "Eres Brain AI, un second brain local (patrón Karpathy Wiki + Obsidian). "
            "Tienes acceso a BRAIN.md, memorias vectoriales y notas con [[wikilinks]]. "
            "Responde en español, concreto y breve."
        )
        local_ctx = build_local_path_context(message)
        if local_ctx:
            system += (
                "\n\nSi el mensaje incluye un bloque «Contexto local», úsalo para listar "
                "archivos o carpetas; no digas que no tienes acceso cuando el listado ya está ahí."
            )
        if brain_block:
            system = f"{system}\n\n{brain_block}"
        if memory_block:
            system = f"{system}\n\n{memory_block}"

        user_content = message
        if local_ctx:
            user_content = f"{message}\n\n## Contexto local (sistema)\n{local_ctx}"

        return (
            [{"role": "system", "content": system}, *trimmed, {"role": "user", "content": user_content}],
            web_results,
        )

    async def _finalize_chat(
        self,
        message: str,
        content: str,
        workflow_id: str | None = None,
    ) -> None:
        mem_type = classify_message(message)
        chat_note_path = None
        try:
            chat_note = vault_service.save_chat_note(message, content or "")
            chat_note_path = chat_note.get("path")
        except Exception:
            chat_note_path = None

        summary = format_chat_memory(message, content or "")
        meta: dict = {
            "user_message_preview": message[:200],
            "source": "chat",
            "vault_note_path": chat_note_path,
        }
        if workflow_id:
            wf = get_workflow(workflow_id)
            if wf:
                meta["workflow_id"] = wf.id
                meta["workflow_name"] = wf.name

        await memory_service.remember_async(
            summary,
            memory_type=mem_type if mem_type != "fact" else "conversation",
            metadata=meta,
        )
        await self._post_save_consolidate()
        invalidate_neuron_cache()

    async def run_workflow(self, workflow: Workflow, model: str | None = None) -> dict:
        web_results: list[dict[str, str]] = []
        if workflow.id == REPO_QUERY_ID:
            web_context = ""
        elif workflow.id == WEB_ASK_ID:
            web_results = search_web(workflow_search_query(workflow), max_results=web_search_max_results())
            web_context = format_results(web_results)
        elif "web_search" in workflow.tools:
            web_results = search_web(workflow_search_query(workflow), max_results=web_search_max_results())
            web_context = format_results(web_results)
        else:
            web_context = ""

        memory_block = await self._memory_context(
            f"{workflow.name} {workflow.description} {settings_niche()}"
        )
        brain_block = await self._brain_context()

        system = build_system_prompt(workflow)
        if brain_block:
            system = f"{system}\n\n{brain_block}"
        if memory_block and workflow.id != REPO_QUERY_ID:
            system = f"{system}\n\n{memory_block}"

        if workflow.id == REPO_QUERY_ID:
            user_content = await self._repo_query_context(None, web_context)
        elif workflow.id == WEB_ASK_ID:
            user_content = await self._web_ask_context(None, web_context)
        else:
            user_content = build_user_context(workflow, web_context)

        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user_content},
        ]
        result = await self.client.chat_messages(messages, model=model)

        summary = (
            f"## Workflow: {workflow.name}\n\n"
            f"{(result['content'] or '').strip()}"
        )
        if len(summary) > WORKFLOW_MEMORY_MAX_CHARS:
            summary = summary[: WORKFLOW_MEMORY_MAX_CHARS - 24] + "\n\n...(truncado)"
        await memory_service.remember_async(
            summary,
            memory_type="workflow_run",
            metadata={"workflow_id": workflow.id, "workflow_name": workflow.name},
        )
        await self._post_save_consolidate()
        invalidate_neuron_cache()

        return {
            "workflow_id": workflow.id,
            "workflow_name": workflow.name,
            "model": result["model"],
            "web_results": web_results,
            "output": result["content"],
        }

    async def chat(
        self,
        message: str,
        model: str | None = None,
        workflow_id: str | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> dict:
        await self._save_auto_facts(message)
        messages, web_results = await self._prepare_chat_messages(message, history, workflow_id)
        result = await self.client.chat_messages(messages, model=model)
        if web_results:
            result = {**result, "web_results": web_results}
        await self._finalize_chat(message, result.get("content") or "", workflow_id)
        return result

    async def chat_stream(
        self,
        message: str,
        model: str | None = None,
        workflow_id: str | None = None,
        history: list[dict[str, str]] | None = None,
    ):
        await self._save_auto_facts(message)
        messages, web_results = await self._prepare_chat_messages(message, history, workflow_id)

        if web_results:
            yield {"type": "web_results", "web_results": web_results}

        parts: list[str] = []
        resolved_model = model or settings.default_model
        async for event in self.client.chat_messages_stream(messages, model=model):
            if event["type"] == "token":
                parts.append(event["content"])
                yield event
            elif event["type"] == "done":
                resolved_model = event.get("model") or resolved_model

        content = "".join(parts)
        await self._finalize_chat(message, content, workflow_id)
        yield {"type": "done", "content": content, "model": resolved_model}


def settings_niche() -> str:
    return settings.niche


CHAT_MEMORY_MAX_CHARS = 48000
WORKFLOW_MEMORY_MAX_CHARS = 48000


def format_chat_memory(user_message: str, assistant_content: str) -> str:
    body = f"## Usuario\n{user_message.strip()}\n\n## Asistente\n{(assistant_content or '').strip()}"
    if len(body) > CHAT_MEMORY_MAX_CHARS:
        body = body[: CHAT_MEMORY_MAX_CHARS - 24] + "\n\n...(truncado)"
    return body
