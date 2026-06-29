from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.vault.service import vault_root, vault_service

ONBOARDING_QUESTIONS = [
    ("who", "¿Quién eres y a qué te dedicas? (como si le contaras a un co-founder)"),
    ("goals", "¿Cuáles son tus objetivos principales este año?"),
    ("style", "¿Cómo quieres que te hable el asistente? (tono, idioma, nivel de detalle)"),
    ("strengths", "¿Cuáles son tus fortalezas y debilidades?"),
    ("projects", "¿En qué proyectos estás ahora mismo?"),
]

STATE_FILE = ".onboarding.json"


def _state_path() -> Path:
    return vault_root() / STATE_FILE


def _load_state() -> dict[str, Any]:
    p = _state_path()
    if not p.exists():
        return {"active": False, "step": 0, "answers": {}}
    return json.loads(p.read_text(encoding="utf-8"))


def _save_state(state: dict[str, Any]) -> None:
    vault_root().mkdir(parents=True, exist_ok=True)
    _state_path().write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def start_onboarding() -> dict[str, Any]:
    vault_service.ensure_vault()
    state = {"active": True, "step": 0, "answers": {}}
    _save_state(state)
    key, question = ONBOARDING_QUESTIONS[0]
    return {"active": True, "step": 1, "total": len(ONBOARDING_QUESTIONS), "question": question, "key": key}


def answer_onboarding(text: str) -> dict[str, Any]:
    state = _load_state()
    if not state.get("active"):
        return {"active": False, "done": False, "message": "No hay onboarding activo. Pulsa Empezar onboarding."}

    step = int(state.get("step", 0))
    if step >= len(ONBOARDING_QUESTIONS):
        return finish_onboarding()

    key, _ = ONBOARDING_QUESTIONS[step]
    state["answers"][key] = text.strip()
    step += 1
    state["step"] = step

    if step >= len(ONBOARDING_QUESTIONS):
        _save_state(state)
        return finish_onboarding()

    _save_state(state)
    next_key, next_q = ONBOARDING_QUESTIONS[step]
    return {
        "active": True,
        "step": step + 1,
        "total": len(ONBOARDING_QUESTIONS),
        "question": next_q,
        "key": next_key,
        "done": False,
    }


def finish_onboarding() -> dict[str, Any]:
    state = _load_state()
    answers = state.get("answers", {})
    content = (
        "# BRAIN — Perfil del usuario\n\n"
        "> Cargado automáticamente en cada sesión (patrón Second Brain / Karpathy Wiki).\n\n"
        f"## Quién soy\n{answers.get('who', '(sin respuesta)')}\n\n"
        f"## Objetivos\n{answers.get('goals', '(sin respuesta)')}\n\n"
        f"## Estilo de comunicación\n{answers.get('style', '(sin respuesta)')}\n\n"
        f"## Fortalezas y debilidades\n{answers.get('strengths', '(sin respuesta)')}\n\n"
        f"## Proyectos actuales\n{answers.get('projects', '(sin respuesta)')}\n\n"
        "Enlaces: [[goals]]\n"
    )
    vault_service.save_profile(content)
    state = {"active": False, "step": len(ONBOARDING_QUESTIONS), "answers": answers, "completed": True}
    _save_state(state)
    return {
        "active": False,
        "done": True,
        "message": "Perfil guardado en BRAIN.md. Ya no tendrás que re-explicarte cada sesión.",
        "profile_path": "BRAIN.md",
    }


def onboarding_status() -> dict[str, Any]:
    state = _load_state()
    profile = vault_service.get_profile()
    has_profile = "pendiente" not in profile.get("content", "").lower() or state.get("completed")
    return {
        "active": state.get("active", False),
        "step": state.get("step", 0),
        "total": len(ONBOARDING_QUESTIONS),
        "completed": state.get("completed", False) or (has_profile and len(state.get("answers", {})) >= 3),
    }
