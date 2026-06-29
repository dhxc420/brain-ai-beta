from __future__ import annotations

import json
import re
from pathlib import Path

_USER_QUERY_RE = re.compile(r"<user_query>\s*(.*?)\s*</user_query>", re.DOTALL | re.I)


def extract_text_from_content(content: list) -> str:
    parts: list[str] = []
    for block in content or []:
        if block.get("type") != "text":
            continue
        text = (block.get("text") or "").strip()
        if not text or text == "[REDACTED]":
            continue
        match = _USER_QUERY_RE.search(text)
        if match:
            text = match.group(1).strip()
        if text:
            parts.append(text)
    return "\n".join(parts).strip()


def parse_transcript_file(path: Path) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    if not path.is_file():
        return messages
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        role = obj.get("role")
        if role not in ("user", "assistant"):
            continue
        text = extract_text_from_content(obj.get("message", {}).get("content", []))
        if len(text) < 8:
            continue
        messages.append({"role": role, "text": text})
    return messages


def find_parent_transcripts(transcript_dir: Path) -> list[Path]:
    if not transcript_dir.is_dir():
        return []
    files: list[Path] = []
    for path in sorted(transcript_dir.rglob("*.jsonl")):
        if "subagents" in path.parts:
            continue
        if path.parent.name == path.stem:
            files.append(path)
    return files


def turns_to_memories(messages: list[dict[str, str]], max_chars: int = 48000) -> list[str]:
    """Agrupa mensajes en bloques usuario+asistente para ChromaDB."""
    chunks: list[str] = []
    i = 0
    while i < len(messages):
        user_text = ""
        assistant_text = ""
        if messages[i]["role"] == "user":
            user_text = messages[i]["text"]
            i += 1
            if i < len(messages) and messages[i]["role"] == "assistant":
                assistant_text = messages[i]["text"]
                i += 1
        elif messages[i]["role"] == "assistant":
            assistant_text = messages[i]["text"]
            i += 1
        else:
            i += 1
            continue

        if not user_text and not assistant_text:
            continue

        body = ""
        if user_text:
            body += f"## Usuario\n{user_text}\n\n"
        if assistant_text:
            body += f"## Asistente\n{assistant_text}"
        body = body.strip()
        if len(body) >= 40:
            if len(body) > max_chars:
                body = body[: max_chars - 24] + "\n\n...(truncado en importación)"
            chunks.append(body)
    return chunks
