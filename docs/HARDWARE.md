# Hardware recomendado

Brain AI corre **100 % local** con [Ollama](https://ollama.com). Elige modelo según tu VRAM.

## Perfiles

| Perfil | GPU / RAM | Modelo sugerido | Notas |
|--------|-----------|-----------------|-------|
| **Mínimo** | 8 GB RAM, sin GPU | `qwen2.5-coder:7b` + `cpu_only` | Lento pero funcional |
| **Recomendado** | RTX 3060–4060 (8 GB) | `qwen2.5-coder:7b` | Default Beta/Premium |
| **Cómodo** | RTX 4070+ (12 GB) | `llama3.1:8b`, `mistral:7b` | `BRAIN_ALLOW_MEDIUM_MODELS=true` |
| **Evitar** | 8 GB VRAM | 14B+ (`qwen2.5:14b`, etc.) | Bloqueado por defecto — satura GPU |

## Variables útiles

```env
BRAIN_DEFAULT_MODEL=qwen2.5-coder:7b
BRAIN_ALLOW_HEAVY_MODELS=false
BRAIN_CPU_ONLY=false
BRAIN_MAX_CONTEXT=4096
BRAIN_MAX_TOKENS=768
```

## Embeddings (memorias RAG)

Siempre local:

```powershell
ollama pull nomic-embed-text
```

Si Ollama no está disponible, las memorias degradan calidad — revisa `/api/health`.

## Consejos

1. Cierra otros consumidores de VRAM (Cline, juegos, otro Ollama).
2. Usa `scripts/start-brain.ps1` — evita múltiples uvicorn en el mismo puerto.
3. En Beta, 4 workflows; en Premium, 5 (incluye Repo/Archivo).
