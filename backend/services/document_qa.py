import re
from collections import Counter
from difflib import SequenceMatcher
from typing import Any

from services.document_index import load_document_index
from services.gemini_service import generate_answer_with_gemini

STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "have",
    "in",
    "is",
    "it",
    "of",
    "on",
    "or",
    "that",
    "the",
    "to",
    "was",
    "were",
    "will",
    "with",
}


def _tokens(value: str) -> list[str]:
    raw = re.findall(r"[a-zA-Z0-9]+", (value or "").lower())
    return [token for token in raw if token not in STOP_WORDS and len(token) > 1]


def _score(question_tokens: list[str], page_text: str) -> float:
    page_tokens = _tokens(page_text)
    if not page_tokens:
        return 0.0

    counts = Counter(page_tokens)
    overlap = sum(counts[token] for token in question_tokens)
    unique_overlap = len(set(question_tokens).intersection(set(page_tokens)))
    return overlap + (unique_overlap * 0.5)


def _rank_pages(question: str, pages: list[dict[str, Any]], top_k: int) -> tuple[list[tuple[float, dict[str, Any]]], bool]:
    """Rank pages by lexical + fuzzy similarity and provide fallback pages when needed."""

    question_tokens = _tokens(question)
    normalized_question = " ".join(question_tokens) or (question or "").strip().lower()
    ranked: list[tuple[float, dict[str, Any]]] = []

    for page in pages:
        page_text = str(page.get("text", ""))
        if not page_text.strip():
            continue

        score = _score(question_tokens, page_text)
        page_text_lower = page_text.lower()

        if normalized_question and normalized_question in page_text_lower:
            score += 4.0

        partial_hits = sum(1 for token in question_tokens if token and token in page_text_lower)
        if partial_hits:
            score += partial_hits * 0.2

        if normalized_question:
            snippet_for_similarity = page_text_lower[:1200]
            score += SequenceMatcher(None, normalized_question, snippet_for_similarity).ratio() * 2.0

        ranked.append((score, page))

    ranked.sort(key=lambda item: (item[0], len(str(item[1].get("text", "")))), reverse=True)
    non_zero = [item for item in ranked if item[0] > 0.6]

    if non_zero:
        return non_zero[: max(top_k, 1)], False

    fallback = sorted(
        [(0.0, page) for page in pages if str(page.get("text", "")).strip()],
        key=lambda item: len(str(item[1].get("text", ""))),
        reverse=True,
    )
    return fallback[: max(top_k, 1)], True


def _fallback_summary(question: str, sources: list[dict[str, Any]]) -> str:
    """Build a concise fallback summary when Gemini is unavailable."""

    combined = " ".join(str(source.get("snippet", "")).strip() for source in sources if source.get("snippet"))
    if not combined:
        return "I could not summarize this content yet."

    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+", combined) if part.strip()]
    picked: list[str] = []
    question_tokens = set(_tokens(question))

    if question_tokens:
        scored = []
        for sentence in sentences:
            sentence_tokens = set(_tokens(sentence))
            overlap = len(question_tokens.intersection(sentence_tokens))
            cleaned = re.sub(r"\s+", " ", sentence).strip()
            non_alnum_ratio = sum(1 for c in cleaned if not c.isalnum() and not c.isspace()) / max(len(cleaned), 1)
            scored.append((overlap, -non_alnum_ratio, len(cleaned), cleaned))
        scored.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
        picked = [item[3][:220].rstrip(" ,;:") + "." for item in scored[:3] if item[3]]
    else:
        picked = [re.sub(r"\s+", " ", s).strip()[:220].rstrip(" ,;:") + "." for s in sentences[:3]]

    if not picked:
        picked = [combined[:420].strip()]

    summary = "\n".join(f"- {line}" for line in picked).strip()
    if not summary:
        return "I could not summarize this content yet."
    return f"Based on the document, here is the best available summary:\n{summary}"


def answer_question_from_index(
    question: str,
    document_id: str,
    top_k: int = 3,
    document_name: str | None = None,
) -> tuple[str, list[dict[str, Any]]]:
    """Return answer + sources from indexed PDF text, using Gemini when available."""

    pages = load_document_index(document_id)
    if not pages:
        return (
            "I could not find indexed content for this document yet. Please try re-uploading the PDF.",
            [],
        )

    selected, used_fallback = _rank_pages(question, pages, top_k=top_k)

    sources: list[dict[str, Any]] = []
    for score, page in selected:
        page_number = int(page.get("page", 0) or 0)
        text = str(page.get("text", ""))
        snippet = re.sub(r"\s+", " ", text[:1200]).strip()
        if not snippet:
            continue
        sources.append(
            {
                "page": page_number,
                "snippet": snippet,
                "score": round(float(score), 2),
            }
        )

    if not sources:
        return (
            "I extracted this PDF, but could not find readable text blocks for your question.",
            [],
        )

    gemini_answer = generate_answer_with_gemini(
        question=question,
        sources=sources,
        document_name=document_name,
    )
    if gemini_answer:
        return gemini_answer, sources

    fallback = _fallback_summary(question, sources)
    if used_fallback:
        return f"{fallback} I used the closest available sections from the document.", sources
    return fallback, sources
