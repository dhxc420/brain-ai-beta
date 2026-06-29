from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from app.config import settings

ROOT = Path(__file__).resolve().parent.parent
REPO_QUERY_ID = "repo_query"
WEB_ASK_ID = "web_ask"
FILE_SNIPPET_MAX = 2500
VAULT_NOTE_MAX = 3000
REPO_SUMMARY_MAX = 2000
DIR_LIST_MAX = 100
ALLOWED_PATHS_FILE = ROOT / "data" / "allowed_paths.json"
_PATH_RE = re.compile(r"(?:[A-Za-z]:[\\/]|\.{0,2}/)[^\s\"'<>|]+")


@dataclass(frozen=True)
class Workflow:
    id: str
    name: str
    description: str
    role: str
    tools: list[str]
    trigger: str
    output: str
    system_prompt: str
    search_query: str
    node_label: str
    node_angle: float


def _now_label() -> str:
    try:
        from zoneinfo import ZoneInfo

        now = datetime.now(ZoneInfo(settings.timezone))
    except Exception:
        now = datetime.now().astimezone()
    return now.strftime("%A %d %B %Y, %H:%M")


WORKFLOWS: dict[str, Workflow] = {
    "morning_briefing": Workflow(
        id="morning_briefing",
        name="Morning Briefing",
        description="Calendario del día, inbox prioritario y una señal de tu nicho.",
        role="Asistente de briefing matutino",
        tools=["web_search"],
        trigger="Diario 07:00",
        output="Un mensaje con 3 secciones: TODAY, INBOX, SIGNAL",
        system_prompt=(
            "Eres mi workflow de morning briefing.\n"
            "Entrega UN solo mensaje con exactamente tres secciones:\n"
            "1. TODAY — agenda del día y reuniones que requieren prep\n"
            "2. INBOX — solo correos que necesitan respuesta hoy (sin newsletters)\n"
            "3. SIGNAL — una noticia relevante de {niche} en las últimas 24h, máx 2 líneas\n\n"
            "Reglas:\n"
            "- Sin preámbulo ni despedida\n"
            "- Si una sección está vacía, dilo en una línea y sigue\n"
            "- Sin relleno, la versión más corta que siga siendo completa\n"
            "- No inventes reuniones ni correos; si no hay datos reales, dilo explícitamente\n"
            "- Responde en español"
        ),
        search_query="{niche} news today",
        node_label="Briefing",
        node_angle=210.0,
    ),
    "daily_digest": Workflow(
        id="daily_digest",
        name="Daily Digest",
        description="Resumen corto de lo más relevante en tu nicho.",
        role="Trend scout",
        tools=["web_search"],
        trigger="Diario 08:00",
        output="Mensaje corto con 3-5 items",
        system_prompt=(
            "Eres mi trend scout para el nicho: {niche}.\n"
            "Dame un digest diario con 3-5 items. Cada item: título + 2 líneas de por qué importa.\n"
            "Filtra ruido. Solo lo realmente relevante. Responde en español."
        ),
        search_query="{niche} latest trends",
        node_label="Digest",
        node_angle=330.0,
    ),
    "trend_scout": Workflow(
        id="trend_scout",
        name="Trend Scout",
        description="5-7 ángulos de contenido con hook, no solo noticias.",
        role="Estratega de contenido",
        tools=["web_search"],
        trigger="Diario 06:30",
        output="Lista de 5-7 ideas con hook",
        system_prompt=(
            "Eres estratega de contenido para audiencia de {niche}.\n"
            "Busca tendencias y devuelve 5-7 ideas de contenido.\n"
            "Formato por idea: HOOK | ÁNGULO | POR QUÉ AHORA\n"
            "Dame ángulos contrarian cuando tenga sentido. Responde en español."
        ),
        search_query="{niche} content ideas viral",
        node_label="Trends",
        node_angle=90.0,
    ),
    REPO_QUERY_ID: Workflow(
        id=REPO_QUERY_ID,
        name="Consultar repo / archivo",
        description=(
            "Pregunta sobre un repo importado, una nota del vault o un archivo local "
            "(p. ej. Vuela RCOL, World Runner, BRAIN.md)."
        ),
        role="Analista de código y notas locales",
        tools=["web_search", "vault", "repos"],
        trigger="Manual — chip Repo / Archivo",
        output="Respuesta basada en repos, vault o archivo local",
        system_prompt=(
            "Eres mi asistente para consultar repositorios importados, notas del vault "
            "Obsidian y archivos locales permitidos.\n\n"
            "Reglas:\n"
            "- Responde SOLO con la información del contexto proporcionado (repos, vault, "
            "memorias RAG, fragmentos de archivo).\n"
            "- Si falta contexto, di qué repo/nota/ruta necesitas — no inventes código ni archivos.\n"
            "- Cita repo, nota o ruta cuando sea relevante.\n"
            "- web_search solo si el usuario pide info externa explícitamente; prioriza contexto local.\n"
            "- Respuestas concisas en español."
        ),
        search_query="{niche}",
        node_label="Repo / Archivo",
        node_angle=150.0,
    ),
    WEB_ASK_ID: Workflow(
        id=WEB_ASK_ID,
        name="Web / Cultura general",
        description=(
            "Búsquedas en internet, curiosidades, cultura general, matemáticas básicas "
            "y preguntas abiertas con apoyo web."
        ),
        role="Asistente de consultas generales",
        tools=["web_search"],
        trigger="Manual — chip Web / General",
        output="Respuesta con datos web y razonamiento directo cuando aplique",
        system_prompt=(
            "Eres mi asistente para preguntas generales: cultura general, curiosidades, "
            "historia, ciencia divulgativa, definiciones y matemáticas básicas.\n\n"
            "Reglas:\n"
            "- Usa los resultados web del contexto cuando existan; cita la fuente si es relevante.\n"
            "- Para aritmética, lógica o conversiones simples puedes calcular sin buscar en web.\n"
            "- Si la búsqueda no alcanza, dilo y responde con lo que sepas de forma honesta.\n"
            "- Respuestas claras en español, sin relleno ni preámbulos largos.\n"
            "- No inventes URLs ni datos que no estén en el contexto web."
        ),
        search_query="noticias curiosidades cultura general ciencia",
        node_label="Web / General",
        node_angle=270.0,
    ),
}


def list_workflows() -> list[dict]:
    from app.edition import feature_enabled

    items = [
        {
            "id": wf.id,
            "name": wf.name,
            "description": wf.description,
            "role": wf.role,
            "tools": wf.tools,
            "trigger": wf.trigger,
            "output": wf.output,
            "node_label": wf.node_label,
            "node_angle": wf.node_angle,
        }
        for wf in WORKFLOWS.values()
    ]
    if not feature_enabled("repo_query"):
        items = [w for w in items if w["id"] != REPO_QUERY_ID]
    return items


def workflow_search_query(workflow: Workflow) -> str:
    return workflow.search_query.format(niche=settings.niche)


def get_workflow(workflow_id: str) -> Workflow | None:
    return WORKFLOWS.get(workflow_id)


def build_user_context(workflow: Workflow, web_context: str, message: str | None = None) -> str:
    if workflow.id == REPO_QUERY_ID:
        return build_repo_query_user_context(message, web_context, memory_block="")
    if workflow.id == WEB_ASK_ID:
        prompt = message or (
            "Con la búsqueda web disponible, comparte 3-5 datos curiosos o noticias "
            "de cultura general, ciencia o historia. Una línea por item."
        )
        return build_web_ask_user_context(prompt, web_context, memory_block="")
    return (
        f"Fecha y hora local: {_now_label()}\n"
        f"Nicho configurado: {settings.niche}\n\n"
        "Contexto de búsqueda web reciente:\n"
        f"{web_context}\n\n"
        "Notas de integraciones pendientes:\n"
        "- Gmail/Calendar aún no conectados. Para TODAY e INBOX indica qué conectarías "
        "y deja placeholders claros si no hay datos reales.\n\n"
        "Genera el entregable ahora."
    )


def _allowed_paths_from_file() -> list[Path]:
    if not ALLOWED_PATHS_FILE.is_file():
        return []
    try:
        data = json.loads(ALLOWED_PATHS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    paths: list[Path] = []
    for item in data:
        if isinstance(item, str) and item.strip():
            paths.append(Path(item.strip()).expanduser())
    return paths


def _extra_allowed_paths() -> list[Path]:
    from app.edition import feature_enabled, local_paths_max_count

    paths: list[Path] = []
    max_count = local_paths_max_count()
    for raw in _allowed_paths_from_file()[:max_count]:
        try:
            paths.append(raw.resolve())
        except OSError:
            paths.append(raw)
    if feature_enabled("local_paths_env") and settings.allowed_paths.strip():
        for part in settings.allowed_paths.split(";"):
            if len(paths) >= max_count:
                break
            part = part.strip()
            if not part:
                continue
            candidate = Path(part).expanduser()
            try:
                paths.append(candidate.resolve())
            except OSError:
                paths.append(candidate)
    return paths[:max_count]


def _allowed_read_path(path: Path) -> bool:
    from app.repos.service import repo_service
    from app.vault.service import vault_root

    resolved = path.resolve()
    allowed = [ROOT.resolve(), vault_root().resolve(), *_extra_allowed_paths()]
    for repo in repo_service.list_repos():
        code_path = repo.get("code_path")
        if code_path:
            allowed.append(Path(code_path).resolve())
    return any(str(resolved).startswith(str(base)) for base in allowed)


def _format_file_size(num_bytes: int) -> str:
    if num_bytes >= 1_073_741_824:
        return f"{num_bytes / 1_073_741_824:.2f} GB"
    if num_bytes >= 1_048_576:
        return f"{num_bytes / 1_048_576:.1f} MB"
    if num_bytes >= 1024:
        return f"{num_bytes / 1024:.1f} KB"
    return f"{num_bytes} B"


def _list_dir_snippet(path_str: str, max_entries: int | None = None) -> str | None:
    from app.edition import dir_list_max, is_beta, local_paths_max_count

    if max_entries is None:
        max_entries = dir_list_max()
    raw = path_str.rstrip(".,;:)")
    try:
        path = Path(raw).expanduser()
        if not path.is_dir():
            return None
        if not _allowed_read_path(path):
            if path.exists():
                hint = (
                    "Añádela a `data/allowed_paths.json`"
                    if is_beta()
                    else "Añádela a `data/allowed_paths.json` o `BRAIN_ALLOWED_PATHS`."
                )
                if is_beta():
                    hint += f" (Beta: máx. {local_paths_max_count()} carpeta extra; Premium: ilimitado)."
                return f"### Carpeta no permitida: `{path}`\n{hint}"
            return None
        children = list(path.iterdir())
        lines: list[str] = []
        sorted_children = sorted(
            children,
            key=lambda p: (not p.is_dir(), p.name.lower()),
        )
        for i, child in enumerate(sorted_children):
            if i >= max_entries:
                lines.append(f"- … y {len(children) - max_entries} entradas más")
                break
            if child.is_dir():
                lines.append(f"- 📁 `{child.name}/`")
            else:
                try:
                    size = _format_file_size(child.stat().st_size)
                except OSError:
                    size = "?"
                lines.append(f"- 📄 `{child.name}` ({size})")
        return f"### Carpeta: `{path}` ({len(children)} entradas)\n" + "\n".join(lines)
    except OSError as exc:
        return f"### Carpeta: `{path_str}`\nError al leer: {exc}"


def _path_context_blocks(message: str) -> list[str]:
    blocks: list[str] = []
    for path_str in _extract_paths(message):
        if block := _list_dir_snippet(path_str):
            blocks.append(block)
            continue
        if block := _read_file_snippet(path_str):
            blocks.append(block)
            continue
        try:
            path = Path(path_str.rstrip(".,;:)")).expanduser()
            if path.exists() and not _allowed_read_path(path):
                kind = "Carpeta" if path.is_dir() else "Archivo"
                blocks.append(
                    f"### {kind} no permitido: `{path}`\n"
                    "Añádela a `data/allowed_paths.json` o a la variable `BRAIN_ALLOWED_PATHS`."
                )
        except OSError:
            continue
    return blocks


def build_local_path_context(message: str) -> str:
    return "\n\n".join(_path_context_blocks(message))


def _read_file_snippet(path_str: str, max_chars: int = FILE_SNIPPET_MAX) -> str | None:
    raw = path_str.rstrip(".,;:)")
    try:
        path = Path(raw).expanduser()
        if not path.is_file() or not _allowed_read_path(path):
            return None
        text = path.read_text(encoding="utf-8", errors="replace")
        if len(text) > max_chars:
            text = text[: max_chars - 24] + "\n\n...(truncado)"
        return f"### Archivo: `{path}`\n```\n{text}\n```"
    except OSError:
        return None


def _extract_paths(message: str) -> list[str]:
    seen: set[str] = set()
    paths: list[str] = []
    for match in _PATH_RE.finditer(message):
        p = match.group(0).rstrip(".,;:)")
        if p not in seen:
            seen.add(p)
            paths.append(p)
    return paths[:4]


def _match_repos(message: str) -> list[dict]:
    from app.repos.service import repo_service

    if not message:
        return []
    lower = message.lower()
    matched: list[dict] = []
    for repo in repo_service.list_repos():
        tokens = [repo["id"], repo.get("label", "")]
        if any(t and t.lower() in lower for t in tokens):
            matched.append(repo)
    return matched


def _match_vault_notes(message: str) -> list[dict]:
    from app.vault.service import vault_service

    if not message:
        return []
    lower = message.lower()
    notes = vault_service.list_notes()
    matched: list[dict] = []
    for note in notes:
        title = note.get("title", "")
        path = note.get("path", "")
        if title.lower() in lower or path.lower() in lower:
            matched.append(note)
            continue
        for link in note.get("links") or []:
            if link.lower() in lower:
                matched.append(note)
                break
    return matched[:3]


def _repo_catalog() -> str:
    from app.repos.service import repo_service
    from app.vault.service import vault_service

    lines = ["## Repositorios importados"]
    repos = repo_service.list_repos()
    if not repos:
        lines.append("(ninguno — configura data/repos.json)")
    for repo in repos:
        lines.append(
            f"- **{repo['label']}** (`{repo['id']}`): {repo.get('description', '')} "
            f"| ruta `{repo.get('code_path', '—')}` | {repo.get('memory_count', 0)} memorias"
        )

    lines.append("\n## Notas del vault")
    try:
        notes = vault_service.list_notes()
        if notes:
            for note in notes[:20]:
                lines.append(f"- `{note['path']}` — {note.get('title', note['path'])}")
            if len(notes) > 20:
                lines.append(f"... y {len(notes) - 20} más")
        else:
            lines.append("(vacío)")
    except Exception:
        lines.append("(no disponible)")

    lines.append(
        "\nPuedes preguntar por nombre de repo, nota del vault o pegar una ruta local permitida "
        "(archivo o carpeta). Carpetas extra: `data/allowed_paths.json` o `BRAIN_ALLOWED_PATHS`."
    )
    return "\n".join(lines)


def _repo_summaries(repos: list[dict]) -> str:
    from app.repos.service import repo_service

    blocks: list[str] = []
    for repo in repos:
        _, full = repo_service.build_repo_neuron_content(repo)
        if len(full) > REPO_SUMMARY_MAX:
            full = full[: REPO_SUMMARY_MAX - 24] + "\n\n...(truncado)"
        blocks.append(full)
    return "\n\n".join(blocks)


def _vault_note_blocks(notes: list[dict]) -> str:
    from app.vault.service import vault_service

    blocks: list[str] = []
    for note in notes:
        try:
            data = vault_service.read_note(note["path"])
            content = data["content"]
            if len(content) > VAULT_NOTE_MAX:
                content = content[: VAULT_NOTE_MAX - 24] + "\n\n...(truncado)"
            blocks.append(f"### Nota vault: `{data['path']}`\n{content}")
        except (FileNotFoundError, ValueError, OSError):
            continue
    return "\n\n".join(blocks)


def build_web_ask_user_context(
    message: str | None,
    web_context: str = "",
    memory_block: str = "",
) -> str:
    parts = [f"Fecha y hora local: {_now_label()}"]
    if message:
        parts.append(f"\n## Pregunta\n{message.strip()}")
    else:
        parts.append("\nEsperando pregunta del usuario.")
    if web_context.strip():
        parts.append(f"\n## Resultados web\n{web_context}")
    if memory_block:
        parts.append(f"\n## Memorias RAG relevantes\n{memory_block}")
    return "\n\n".join(parts)


def build_repo_query_user_context(
    message: str | None,
    web_context: str = "",
    memory_block: str = "",
) -> str:
    parts = [
        f"Fecha y hora local: {_now_label()}",
        _repo_catalog(),
    ]

    if message:
        parts.append(f"\n## Pregunta del usuario\n{message.strip()}")

        matched_repos = _match_repos(message)
        if matched_repos:
            parts.append("\n## Contexto de repos detectados\n" + _repo_summaries(matched_repos))

        matched_notes = _match_vault_notes(message)
        if matched_notes:
            note_block = _vault_note_blocks(matched_notes)
            if note_block:
                parts.append("\n## Notas vault relevantes\n" + note_block)

        path_blocks = _path_context_blocks(message)
        if path_blocks:
            parts.append("\n## Contexto local (archivos/carpetas)\n" + "\n\n".join(path_blocks))
    else:
        parts.append(
            "\nNo hay pregunta aún. Resume repos y notas disponibles e invita a escribir en el chat."
        )

    if memory_block:
        parts.append(f"\n## Memorias RAG relevantes\n{memory_block}")

    if web_context.strip():
        parts.append(f"\n## Búsqueda web (si aplica)\n{web_context}")

    return "\n\n".join(parts)


def repo_query_wants_web(message: str) -> bool:
    lower = message.lower()
    hints = (
        "buscar en web",
        "busca en internet",
        "buscar en internet",
        "noticias",
        " google ",
        " online ",
        "web_search",
    )
    return any(h in lower for h in hints)


def build_system_prompt(workflow: Workflow) -> str:
    return workflow.system_prompt.format(niche=settings.niche)
