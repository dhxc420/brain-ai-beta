from __future__ import annotations

import hashlib

import httpx

from app.config import settings

EMBED_MODEL = "nomic-embed-text"
FALLBACK_MODELS = ("nomic-embed-text", "mxbai-embed-large", "all-minilm")
EMBED_DIM = 768


def _hash_embedding(text: str, dim: int = EMBED_DIM) -> list[float]:
    """Embedding determinista cuando Ollama no está disponible."""
    vec: list[float] = []
    for i in range(dim):
        digest = hashlib.sha256(f"{text}:{i}".encode()).digest()
        # Valor acotado en [-1, 1] sin NaN
        val = (int.from_bytes(digest[:4], "big") / 0xFFFFFFFF) * 2.0 - 1.0
        vec.append(val)
    norm = sum(x * x for x in vec) ** 0.5 or 1.0
    return [x / norm for x in vec]


async def embed_text(text: str, model: str | None = None) -> list[float]:
    """Genera embedding vía Ollama /api/embeddings."""
    chosen = model or settings.embed_model
    async with httpx.AsyncClient(timeout=20.0) as client:
        for candidate in ([chosen] if chosen else []) + list(FALLBACK_MODELS):
            try:
                response = await client.post(
                    f"{settings.ollama_base_url.rstrip('/')}/api/embeddings",
                    json={"model": candidate, "prompt": text},
                )
                if response.status_code == 404:
                    continue
                response.raise_for_status()
                data = response.json()
                embedding = data.get("embedding")
                if embedding:
                    return embedding
            except Exception:
                continue
    return _hash_embedding(text)


def ollama_embeddings_ready(timeout: float = 2.0) -> bool:
    """Comprueba si Ollama responde a /api/embeddings (evita bloquear imports largos)."""
    chosen = settings.embed_model or EMBED_MODEL
    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.post(
                f"{settings.ollama_base_url.rstrip('/')}/api/embeddings",
                json={"model": chosen, "prompt": "ping"},
            )
            if response.status_code == 404:
                return False
            response.raise_for_status()
            return bool(response.json().get("embedding"))
    except Exception:
        return False


def embed_text_sync(text: str, model: str | None = None, *, timeout: float = 20.0) -> list[float]:
    """Versión síncrona para ChromaDB en hilos sin event loop."""
    chosen = model or settings.embed_model
    with httpx.Client(timeout=timeout) as client:
        for candidate in ([chosen] if chosen else []) + list(FALLBACK_MODELS):
            try:
                response = client.post(
                    f"{settings.ollama_base_url.rstrip('/')}/api/embeddings",
                    json={"model": candidate, "prompt": text},
                )
                if response.status_code == 404:
                    continue
                response.raise_for_status()
                data = response.json()
                embedding = data.get("embedding")
                if embedding:
                    return embedding
            except Exception:
                continue
    return _hash_embedding(text)
