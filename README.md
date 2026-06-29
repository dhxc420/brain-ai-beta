# Brain AI — Beta (gratis)

Second brain local: Ollama + FastAPI + ChromaDB + vault Obsidian + cerebro 3D.

**Edición Beta** — gratis, open source, con límites suaves para probar el producto.  
**Premium** (Repo/Archivo, Cursor, rutas ilimitadas): [docs/PREMIUM.md](docs/PREMIUM.md)

Repo público: https://github.com/dhxc420/brain-ai-beta

---

## Inicio rápido

```powershell
git clone https://github.com/dhxc420/brain-ai-beta.git
cd brain-ai-beta
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
ollama pull qwen2.5-coder:7b
ollama pull nomic-embed-text
.\scripts\start-brain.ps1
```

Abre la URL del script (p. ej. **http://127.0.0.1:8789**).

## Qué incluye Beta

| Función | Beta | Premium |
|---------|------|---------|
| Chat multi-turn + streaming | ✅ (4 turnos) | ✅ (12 turnos) |
| 4 workflows (Briefing, Digest, Trends, Web) | ✅ | 5 (+ Repo/Archivo) |
| Memorias RAG + búsqueda 🔍 | ✅ (~60) | ✅ ilimitado |
| Vault Obsidian + cerebro 3D | ✅ | ✅ |
| **1 carpeta local** (`allowed_paths.json`) | ✅ breve | ✅ ilimitado |
| Listado directorio por carpeta | 12 entradas | 100 entradas |
| Búsqueda web | 3 resultados | 5 resultados |
| Consolidar / olvidar memorias | ❌ | ✅ |
| Repo / Archivo + Cursor import | ❌ | ✅ |
| `BRAIN_ALLOWED_PATHS` en `.env` | ❌ | ✅ |

Detalle completo: [docs/EDITIONS.md](docs/EDITIONS.md)

### Rutas locales (Beta)

Puedes añadir **una** carpeta en `data/allowed_paths.json` para listar archivos en el chat (p. ej. `F:\#isos`). El listado muestra hasta **12 entradas** por consulta. Para más carpetas, env vars y el chip Repo/Archivo → Premium.

## Hardware

Guía por GPU/RAM: [docs/HARDWARE.md](docs/HARDWARE.md)

RTX 4060 8GB → `qwen2.5-coder:7b` · no uses 14B+ en producción.

## Variables (`BRAIN_*`)

| Variable | Default Beta |
|----------|----------------|
| `BRAIN_EDITION` | `beta` |
| `BRAIN_DEFAULT_MODEL` | `qwen2.5-coder:7b` |
| `BRAIN_EMBED_MODEL` | `nomic-embed-text` |
| `BRAIN_CHAT_HISTORY_MAX_TURNS` | `12` (cap efectivo: 4) |
| `BRAIN_ALLOW_HEAVY_MODELS` | `false` |

## Estructura

```
app/           Backend FastAPI, agente, memorias, vault
static/        UI + cerebro Three.js
scripts/       start-brain.ps1, tests E2E
docs/          Ediciones, hardware, Premium
examples/      Plantillas allowed_paths.json (Premium: repos.json)
```

## Premium

**$49 USD** licencia personal — pago único.

| Método | Enlace / dirección |
|--------|-------------------|
| PayPal | https://www.paypal.com/paypalme/dzc2000 |
| Bitcoin (BTC) | `1Pwsmb9oif9si5jbSWPMKxRN8hrZoE1Dqq` |
| WLD (Worldchain) | `0xe07c9d1c8b848b461fe65c39fab80bb1bb654bde` |

Instrucciones tras el pago: [docs/PREMIUM.md](docs/PREMIUM.md)

## Licencia

MIT para edición Beta — ver [LICENSE](LICENSE).
