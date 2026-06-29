from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

import httpx

from app.config import settings
from app.models import is_model_allowed, model_tier, pick_default_model

_lock = asyncio.Lock()


class ModelNotAllowedError(ValueError):
    pass


class OllamaBusyError(RuntimeError):
    pass


class OllamaClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")

    def resolve_model(self, model: str | None, available: list[str] | None = None) -> str:
        chosen = model or settings.default_model
        if available and chosen not in available:
            chosen = pick_default_model(available, settings.default_model)
        if not is_model_allowed(
            chosen,
            allow_medium=settings.allow_medium_models,
            allow_heavy=settings.allow_heavy_models,
        ):
            tier = model_tier(chosen)
            raise ModelNotAllowedError(
                f"Modelo '{chosen}' ({tier}) bloqueado. "
                f"Usa {settings.default_model} como en X Publisher."
            )
        return chosen

    def _options(self) -> dict:
        opts: dict = {
            "num_ctx": settings.max_context,
            "num_predict": settings.max_tokens,
            "temperature": settings.temperature,
        }
        if settings.cpu_only:
            opts["num_gpu"] = 0
        return opts

    async def list_loaded(self) -> list[dict]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/ps")
                response.raise_for_status()
                return response.json().get("models", [])
        except Exception:
            return []

    async def unload_all(self) -> None:
        loaded = await self.list_loaded()
        if not loaded:
            return
        async with httpx.AsyncClient(timeout=15.0) as client:
            for entry in loaded:
                name = entry.get("name", "")
                if not name:
                    continue
                try:
                    await client.post(
                        f"{self.base_url}/api/generate",
                        json={"model": name, "prompt": "", "keep_alive": 0},
                    )
                except Exception:
                    pass

    async def health(self) -> dict:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                data = response.json()
                raw = data.get("models", [])
                models = [m.get("name", "") for m in raw if m.get("name")]
                safe_default = pick_default_model(models, settings.default_model)
                loaded = await self.list_loaded()
                heavy_loaded = [
                    m.get("name", "")
                    for m in loaded
                    if model_tier(m.get("name", "")) == "heavy"
                ]
                return {
                    "ok": True,
                    "models": models,
                    "default_model": safe_default,
                    "loaded_models": [m.get("name") for m in loaded],
                    "heavy_loaded": heavy_loaded,
                }
        except Exception as exc:
            return {
                "ok": False,
                "models": [],
                "default_model": settings.default_model,
                "loaded_models": [],
                "heavy_loaded": [],
                "error": str(exc),
            }

    async def _prepare_model(self, model: str | None) -> str:
        if _lock.locked():
            raise OllamaBusyError(
                "Ollama ocupado — espera a que termine la petición anterior."
            )
        health = await self.health()
        available = health.get("models", [])
        resolved = self.resolve_model(model, available)
        if settings.unload_before_request:
            await self.unload_all()
        return resolved

    async def generate(
        self,
        system: str,
        user: str,
        model: str | None = None,
    ) -> dict:
        async with _lock:
            resolved = await self._prepare_model(model)
            prompt = f"{system.strip()}\n\n{user.strip()}" if system.strip() else user.strip()
            payload = {
                "model": resolved,
                "prompt": prompt,
                "stream": False,
                "keep_alive": settings.keep_alive_seconds,
                "options": self._options(),
            }

            async with httpx.AsyncClient(timeout=180.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
                content = data.get("response", "")

            await self.unload_all()
            return {"content": content, "model": resolved}

    async def chat_messages(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
    ) -> dict:
        async with _lock:
            resolved = await self._prepare_model(model)
            payload = {
                "model": resolved,
                "messages": messages,
                "stream": False,
                "keep_alive": settings.keep_alive_seconds,
                "options": self._options(),
            }

            async with httpx.AsyncClient(timeout=180.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/chat",
                    json=payload,
                )
                response.raise_for_status()
                data = response.json()
                content = data.get("message", {}).get("content", "")

            await self.unload_all()
            return {"content": content, "model": resolved}

    async def chat_messages_stream(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
    ) -> AsyncIterator[dict[str, str]]:
        async with _lock:
            resolved = await self._prepare_model(model)
            payload = {
                "model": resolved,
                "messages": messages,
                "stream": True,
                "keep_alive": settings.keep_alive_seconds,
                "options": self._options(),
            }

            try:
                async with httpx.AsyncClient(timeout=180.0) as client:
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/api/chat",
                        json=payload,
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line:
                                continue
                            try:
                                data = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            if data.get("done"):
                                yield {"type": "done", "model": data.get("model") or resolved}
                                break
                            chunk = data.get("message", {}).get("content", "")
                            if chunk:
                                yield {"type": "token", "content": chunk}
            finally:
                await self.unload_all()

    async def chat(
        self,
        messages: list[dict[str, str]],
        model: str | None = None,
    ) -> dict:
        return await self.chat_messages(messages, model=model)
