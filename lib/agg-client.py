"""
Thin wrapper around AgentGauntlet's public API.
Python equivalent of lib/agg-client.js.

Zero extra dependencies — uses only Python stdlib (urllib, json, os, time).
Drop-in for participants using Python-based agent frameworks:
  LangGraph, Google ADK, CrewAI, Smolagents, Pydantic AI, AutoGen, etc.

Swap in `requests` or `httpx` freely if you prefer them (see comments).

Async note: every function here is synchronous. For async frameworks
(ADK, Pydantic AI) wrap calls with asyncio.to_thread():
    result = await asyncio.to_thread(session_result, session_id)
Or install httpx and use httpx.AsyncClient directly.
"""

import json
import os
import time
import urllib.error
import urllib.request
from urllib.parse import quote

DEFAULT_BASE = "https://agentgauntlet.ai"


def get_key() -> str:
    key = os.environ.get("AG_KEY", "")
    if not key.startswith("agg_"):
        raise RuntimeError(
            'AG_KEY is required and must start with "agg_". '
            "Get one at https://agentgauntlet.ai/keys.html"
        )
    return key


def base_url() -> str:
    return os.environ.get("AG_BASE_URL", DEFAULT_BASE).rstrip("/")


def authed_fetch(
    path_or_url: str,
    *,
    method: str = "GET",
    body: dict | None = None,
    _attempt: int = 1,
) -> dict:
    """
    Make an authenticated request and return parsed JSON.

    Uses x-api-key header (NOT Authorization: Bearer — that's only for
    the events /join flow).  Retries up to 3 times on 5xx / network errors.

    Args:
        path_or_url: e.g. "/api/keys/me" or a full https:// URL
        method:      HTTP verb, default "GET"
        body:        dict to JSON-encode as the request body

    Returns:
        Parsed JSON response as a dict.

    Raises:
        RuntimeError: on HTTP 4xx or repeated 5xx
        urllib.error.URLError: on persistent network failure
    """
    url = path_or_url if path_or_url.startswith("http") else f"{base_url()}{path_or_url}"
    headers = {
        "x-api-key": get_key(),
        "Accept": "application/json",
    }
    data: bytes | None = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as err:
        # Retry on 5xx — transient. 4xx is your bug, don't retry.
        if err.code >= 500 and _attempt < 3:
            time.sleep(0.3 * _attempt)
            return authed_fetch(path_or_url, method=method, body=body, _attempt=_attempt + 1)
        body_text = err.read().decode()
        raise RuntimeError(f"HTTP {err.code} from {url}: {body_text}") from err
    except urllib.error.URLError as err:
        if _attempt < 3:
            time.sleep(0.3 * _attempt)
            return authed_fetch(path_or_url, method=method, body=body, _attempt=_attempt + 1)
        raise


def whoami() -> dict:
    """
    Look up your own key info (tier, daily limit, runs today).
    Useful for verifying your key works before launching a browser.

    Returns dict with keys: name, tier, daily_limit, runs_today, ...
    """
    return authed_fetch("/api/keys/me")


def start_session(*, mode: str = "cv") -> dict:
    """
    Start a new benchmarking session.

    Returns dict with: sessionId, token, tasks, scenarioUrl
    Open `scenarioUrl` in Playwright — the page's own JS handles
    fingerprint submission and step progression.

    mode="cv" returns tasks as human-readable strings (use with LLM).
    mode="json" returns tasks as structured JSON (use for DOM-only agents).
    """
    return authed_fetch("/api/v2/session", method="POST", body={"mode": mode})


def session_result(session_id: str) -> dict:
    """
    Fetch the structured result of a completed session.
    Read this after EVERY run — it shows which signals fired and why.

    Paid/event-tier keys see the full signal_counts breakdown.
    Free keys see a coarser summary.

    Returns dict with:
        session_id, scenario, outcome ("complete"|"block"|...),
        risk_score (0-100, lower is better),
        risk_tier ("allow"|"step_up"|"block"),
        elapsed_ms,
        signal_counts: { "synthetic_click_dwell": 3, ... }
    """
    return authed_fetch(f"/api/session/{quote(session_id, safe='')}/result")
