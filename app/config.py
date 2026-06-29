from pydantic_settings import BaseSettings

from app.models import RECOMMENDED


class Settings(BaseSettings):
    ollama_base_url: str = "http://127.0.0.1:11434"
    default_model: str = RECOMMENDED
    host: str = "127.0.0.1"
    port: int = 8787
    niche: str = "AI agents and local LLMs"
    timezone: str = "America/Mexico_City"

    # Mismo patrón seguro que X Publisher (una llamada, sin chat acumulado)
    max_context: int = 4096
    max_tokens: int = 768
    temperature: float = 0.4
    keep_alive_seconds: int = 0
    allow_medium_models: bool = True
    allow_heavy_models: bool = False
    unload_before_request: bool = True
    cpu_only: bool = False

    chroma_path: str = "data/chroma"
    vault_path: str = "data/vault"
    repos_config_path: str = "data/repos.json"
    allowed_paths: str = ""
    chat_history_max_turns: int = 12
    edition: str = "beta"
    premium_upgrade_url: str = "https://github.com/dhxc420/brain-ai-beta/blob/main/docs/PREMIUM.md"
    embed_model: str = "nomic-embed-text"

    class Config:
        env_prefix = "BRAIN_"
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
