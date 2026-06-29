# Brain AI — Ediciones Beta y Premium

Dos **repositorios separados** (no dos ramas del mismo repo):

| | **Beta** (gratis) | **Premium** (de pago) |
|---|-------------------|------------------------|
| Repo | [github.com/dhxc420/brain-ai-beta](https://github.com/dhxc420/brain-ai-beta) | `brain-ai-premium` (privado, compradores) |
| Precio | $0 | Ver [PREMIUM.md](PREMIUM.md) |
| Chat multi-turn + streaming | ✅ (4 turnos) | ✅ (12 turnos) |
| Memorias RAG + ChromaDB | ✅ (~60 soft cap) | ✅ ilimitado |
| Consolidar / olvidar memorias | ❌ | ✅ |
| Vault Obsidian | ✅ | ✅ |
| Cerebro 3D | ✅ | ✅ |
| Web / Cultura general | ✅ (3 resultados) | ✅ (5 resultados) |
| Briefing / Digest / Trends | ✅ | ✅ |
| Búsqueda 🔍 API | 15 resultados | 50 resultados |
| **Rutas locales** | **1 carpeta**, 12 entradas/listado | Ilimitado, 100 entradas/listado |
| `BRAIN_ALLOWED_PATHS` en `.env` | ❌ | ✅ |
| **Repo / Archivo** (Cursor, código) | ❌ | ✅ |
| **Importar chats Cursor → repos** | ❌ | ✅ |
| Soporte / actualizaciones prioritarias | Comunidad | Licencia |

Los límites Beta están en `app/edition.py` y se aplican en backend (no solo UI).

## Activar edición

```env
# Beta (default en repo público)
BRAIN_EDITION=beta

# Premium (tras compra — copia .env.premium.example)
BRAIN_EDITION=premium
```

Reinicia con `scripts/start-brain.ps1` tras cambiar `.env`.

## Rutas locales en Beta

Beta incluye acceso **breve** a carpetas locales:

1. Añade **una** ruta en `data/allowed_paths.json`.
2. Pregunta en chat por esa carpeta; el listado muestra hasta **12** entradas.
3. Para más carpetas, variables de entorno o Repo/Archivo → Premium.

## Hardware

Ambas ediciones se adaptan a tu GPU/CPU vía Ollama. Guía: [HARDWARE.md](HARDWARE.md).

## Modelo de negocio

- **Beta:** uso personal y pruebas; código visible; funciones Pro limitadas o bloqueadas.
- **Premium:** licencia individual; pago único vía PayPal, Bitcoin o WLD (Worldchain); acceso al repo privado + todas las funciones.

Pagos Premium ($49 USD): [PREMIUM.md](PREMIUM.md) — PayPal [dzc2000](https://www.paypal.com/paypalme/dzc2000), BTC `1Pwsmb9oif9si5jbSWPMKxRN8hrZoE1Dqq`, WLD `0xe07c9d1c8b848b461fe65c39fab80bb1bb654bde`.

No hay crack ni bypass: las funciones Pro se validan en backend (`app/edition.py`).
