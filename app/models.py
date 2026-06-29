from __future__ import annotations

import asyncio
import re

# Igual que X Publisher: 7B cabe en RTX 4060 8GB. 14B+ puede tumbar el PC.
HEAVY_HINTS = ("14b", "13b", "12b", "34b", "32b", "70b", "72b", "22b", "mixtral", "8x7b")
LITE_HINTS = ("1b", "1.5b", "2b", "3b", "0.5b", "phi3:mini", "tinyllama")
MEDIUM_HINTS = ("7b", "8b")

# Mismo modelo probado en F:\X PUBLISHER AUTOMATIC
RECOMMENDED = "qwen2.5-coder:7b"


def model_tier(name: str) -> str:
    low = name.lower()
    if any(h in low for h in HEAVY_HINTS):
        return "heavy"
    if any(h in low for h in LITE_HINTS):
        return "lite"
    if any(h in low for h in MEDIUM_HINTS):
        return "medium"
    match = re.search(r":(\d+)b", low)
    if match:
        params = int(match.group(1))
        if params >= 12:
            return "heavy"
        if params <= 3:
            return "lite"
        return "medium"
    return "medium"


def is_model_allowed(name: str, *, allow_medium: bool, allow_heavy: bool) -> bool:
    tier = model_tier(name)
    if tier == "heavy":
        return allow_heavy
    if tier == "medium":
        return allow_medium
    return True


def pick_default_model(available: list[str], preferred: str) -> str:
    if preferred in available and is_model_allowed(preferred, allow_medium=True, allow_heavy=False):
        return preferred
    for candidate in (RECOMMENDED, "llama3.1:8b", "llama3.2:3b"):
        if candidate in available and is_model_allowed(candidate, allow_medium=True, allow_heavy=False):
            return candidate
    for name in available:
        if is_model_allowed(name, allow_medium=True, allow_heavy=False):
            return name
    return preferred if preferred in available else (available[0] if available else RECOMMENDED)


def model_info(name: str) -> dict:
    tier = model_tier(name)
    labels = {
        "lite": "Ultra ligero",
        "medium": "7B/8B — probado en tu PC (X Publisher)",
        "heavy": "BLOQUEADO — apaga el PC",
    }
    return {"name": name, "tier": tier, "label": labels[tier]}


def annotate_models(names: list[str]) -> list[dict]:
    return [model_info(n) for n in names]
