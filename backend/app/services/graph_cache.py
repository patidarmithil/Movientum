"""
Movientum — Graph Cache (Phase 3)

Builds and holds an in-memory NetworkX bipartite content graph over
the entire content_catalog table.  Rebuilt once at startup (and on
demand after nightly retraining).  Shared as a module-level singleton
across all async workers inside a single Uvicorn process.

Node types:
    ContentNode  "m:{tmdb_id}" | "tv:{tmdb_id}"
    GenreNode    "g:{genre_id}"
    KeywordNode  "k:{keyword_id}"
    TalentNode   "p:{person_id}"
    EraNode      "e:{era_string}"
    LanguageNode "l:{lang_code}"

Edge weights follow the plan rationale:
    director  2.5  — strongest creative signal
    keyword   1.5  — thematic specificity
    genre     1.0  — baseline
    cast      0.8
    era       0.6
    language  0.4
"""
import logging
from typing import Optional

import networkx as nx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.orm_models import ContentCatalog

logger = logging.getLogger(__name__)

# ── Module-level singleton ────────────────────────────────────────
_GRAPH: Optional[nx.Graph] = None

EDGE_WEIGHTS = {
    "genre":    1.0,
    "keyword":  1.5,
    "director": 2.5,
    "cast":     0.8,
    "era":      0.6,
    "language": 0.4,
}


# ── Graph Construction ────────────────────────────────────────────

def _node_id(row: ContentCatalog) -> str:
    """Canonical content node ID: 'm:550' or 'tv:1399'."""
    prefix = "m" if row.media_type == "movie" else "tv"
    return f"{prefix}:{row.tmdb_id}"


def build_graph_from_rows(catalog_rows: list[ContentCatalog]) -> nx.Graph:
    """
    Constructs bipartite content graph synchronously from a list of
    ContentCatalog ORM rows.

    Time complexity: O(N × F) where N = catalog size, F ≈ avg features/item.
    For 20 K items × ~30 features ≈ 600 K edge insertions → ~5–10 s.
    """
    G = nx.Graph()

    for row in catalog_rows:
        nid = _node_id(row)
        G.add_node(
            nid,
            type="content",
            tmdb_id=row.tmdb_id,
            media_type=row.media_type,
            vote_average=row.vote_average or 0.0,
            popularity=row.popularity or 0.0,
            release_era=row.release_era or "unknown",
        )

        # Genre edges
        for gid in (row.genre_ids or []):
            feat = f"g:{gid}"
            G.add_node(feat, type="genre")
            G.add_edge(nid, feat, weight=EDGE_WEIGHTS["genre"])

        # Keyword edges
        for kid in (row.keyword_ids or []):
            feat = f"k:{kid}"
            G.add_node(feat, type="keyword")
            G.add_edge(nid, feat, weight=EDGE_WEIGHTS["keyword"])

        # Cast edges
        for pid in (row.cast_ids or []):
            feat = f"p:{pid}"
            G.add_node(feat, type="talent")
            # Only upgrade weight if director already added; otherwise cast
            if not G.has_edge(nid, feat):
                G.add_edge(nid, feat, weight=EDGE_WEIGHTS["cast"])

        # Director edges (higher weight — may override cast edge if same person)
        crew = row.crew_ids or {}
        for pid in crew.get("director", []):
            feat = f"p:{pid}"
            G.add_node(feat, type="talent")
            # Use max weight if edge already exists
            if G.has_edge(nid, feat):
                G[nid][feat]["weight"] = max(
                    G[nid][feat]["weight"], EDGE_WEIGHTS["director"]
                )
            else:
                G.add_edge(nid, feat, weight=EDGE_WEIGHTS["director"])

        # Era node
        if row.release_era:
            feat = f"e:{row.release_era}"
            G.add_node(feat, type="era")
            G.add_edge(nid, feat, weight=EDGE_WEIGHTS["era"])

        # Language node
        if row.original_language:
            feat = f"l:{row.original_language}"
            G.add_node(feat, type="language")
            G.add_edge(nid, feat, weight=EDGE_WEIGHTS["language"])

    logger.info(
        "Graph built: %d nodes, %d edges (from %d catalog rows)",
        G.number_of_nodes(),
        G.number_of_edges(),
        len(catalog_rows),
    )
    return G


# ── Lifecycle ─────────────────────────────────────────────────────

async def get_or_build_graph(db: AsyncSession) -> nx.Graph:
    """
    Returns cached graph.  Rebuilds from DB if None (first call or
    after invalidate_graph() is called).

    The graph is held in a module-level singleton — shared across all
    async workers within a single Uvicorn process.
    """
    global _GRAPH
    if _GRAPH is None:
        logger.info("Graph not found in cache — building from content_catalog …")
        result = await db.execute(select(ContentCatalog))
        rows = result.scalars().all()
        if not rows:
            logger.warning("content_catalog is empty — graph will be empty")
            _GRAPH = nx.Graph()
        else:
            _GRAPH = build_graph_from_rows(rows)
    return _GRAPH


def invalidate_graph() -> None:
    """
    Drop the cached graph.  Call this after nightly retraining writes
    new rows into content_catalog so the next request triggers a rebuild.
    """
    global _GRAPH
    _GRAPH = None
    logger.info("Graph cache invalidated — will rebuild on next request")


def get_graph_stats() -> dict:
    """Return basic stats about the current in-memory graph (for health checks)."""
    if _GRAPH is None:
        return {"status": "not_built", "nodes": 0, "edges": 0}
    content_nodes = sum(
        1 for _, d in _GRAPH.nodes(data=True) if d.get("type") == "content"
    )
    return {
        "status": "ready",
        "nodes": _GRAPH.number_of_nodes(),
        "edges": _GRAPH.number_of_edges(),
        "content_nodes": content_nodes,
    }
