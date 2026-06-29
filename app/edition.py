"""Edición Beta (pública) vs Premium (de pago). Dos repos separados — no dos ramas."""

from __future__ import annotations

from app.config import settings

# Funciones bloqueadas por completo en Beta
BETA_DISABLED_FEATURES = frozenset(
    {
        "repo_sync",
        "repo_query",
        "repos_panel",
        "local_paths_env",
        "memory_consolidate",
        "memory_forget_stale",
    }
)

PREMIUM_PRICE_USD = 49

# Límites numéricos Beta
BETA_CHAT_HISTORY_MAX = 4
BETA_MEMORY_SOFT_CAP = 60
BETA_LOCAL_PATHS_MAX = 1
BETA_DIR_LIST_MAX = 12
BETA_WEB_SEARCH_MAX = 3
BETA_SEARCH_LIMIT = 15


def edition() -> str:
    raw = (settings.edition or "beta").strip().lower()
    return "premium" if raw == "premium" else "beta"


def is_premium() -> bool:
    return edition() == "premium"


def is_beta() -> bool:
    return not is_premium()


def feature_enabled(name: str) -> bool:
    if is_premium():
        return True
    return name not in BETA_DISABLED_FEATURES


def chat_history_limit() -> int:
    if is_premium():
        return settings.chat_history_max_turns
    return min(settings.chat_history_max_turns, BETA_CHAT_HISTORY_MAX)


def dir_list_max() -> int:
    return DIR_LIST_MAX_PREMIUM if is_premium() else BETA_DIR_LIST_MAX


def local_paths_max_count() -> int:
    return 999 if is_premium() else BETA_LOCAL_PATHS_MAX


def web_search_max_results() -> int:
    return 5 if is_premium() else BETA_WEB_SEARCH_MAX


def search_api_limit() -> int:
    return 50 if is_premium() else BETA_SEARCH_LIMIT


def memory_soft_cap() -> int | None:
    return None if is_premium() else BETA_MEMORY_SOFT_CAP


DIR_LIST_MAX_PREMIUM = 100


def edition_info() -> dict:
    return {
        "edition": edition(),
        "premium": is_premium(),
        "upgrade_url": settings.premium_upgrade_url,
        "limits": {
            "chat_history_turns": chat_history_limit(),
            "memory_soft_cap": memory_soft_cap(),
            "local_paths_max": local_paths_max_count(),
            "dir_list_max": dir_list_max(),
        },
        "features": {
            "repo_sync": feature_enabled("repo_sync"),
            "repo_query": feature_enabled("repo_query"),
            "local_paths": True,
            "local_paths_full": is_premium(),
            "repos_panel": feature_enabled("repos_panel"),
            "memory_consolidate": feature_enabled("memory_consolidate"),
            "memory_forget_stale": feature_enabled("memory_forget_stale"),
        },
    }
