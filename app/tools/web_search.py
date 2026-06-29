from __future__ import annotations

from ddgs import DDGS


def search_web(query: str, max_results: int = 5) -> list[dict[str, str]]:
    try:
        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=max_results))
        return [
            {
                "title": item.get("title", ""),
                "snippet": item.get("body", ""),
                "url": item.get("href", ""),
            }
            for item in results
        ]
    except Exception as exc:
        return [{"title": "Search error", "snippet": str(exc), "url": ""}]


def format_results(results: list[dict[str, str]]) -> str:
    if not results:
        return "No se encontraron resultados."
    lines: list[str] = []
    for index, item in enumerate(results, start=1):
        lines.append(f"{index}. {item['title']}")
        lines.append(f"   {item['snippet']}")
        if item["url"]:
            lines.append(f"   {item['url']}")
    return "\n".join(lines)
