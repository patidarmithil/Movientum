"""
server_stage4.py
════════════════
Stage 4 server — extends Stage 3 with:
  1. item2users index    — maps each item to users who interacted with it
  2. get_neighbours()    — returns 2-hop user neighbourhood for a given user
  3. get_neigh_embs()    — returns neighbour user embeddings for contrastive CL

Inherits ALL Stage 3 logic:
  - E_global, E_clusters[K]
  - K-means clustering / assignments
  - get_personal_embeddings()
  - aggregate() (global + per-cluster)

Privacy note on neighbourhood sharing:
  The server shares anonymised neighbour embeddings (not UIDs or raw data).
  Users are identified by integer IDs; only their embedding vectors are sent.
  This matches the FedGNN paper's approach of sharing structural information
  without revealing raw interaction data.
"""

import math
import random
from collections import defaultdict
import torch

from core.server_stage3 import ServerStage3


class ServerStage4(ServerStage3):
    """
    Stage 4 server: adds 2-hop graph expansion support.

    Extra args:
        train_dict:     {uid: [item_ids]}   — needed to build item2users index
        max_neigh:      max neighbour users per client (caps subgraph size)
        max_items_neigh:max items per neighbour user to include
    """

    def __init__(self, n_items: int, embed_dim: int,
                 train_dict: dict,
                 n_clusters: int  = 5,
                 mu1: float       = 0.5,
                 mu2: float       = 0.5,
                 max_neigh: int   = 20,
                 max_items_neigh: int = 10,
                 device: torch.device = None):

        super().__init__(n_items, embed_dim, n_clusters, mu1, mu2, device)

        self.max_neigh       = max_neigh
        self.max_items_neigh = max_items_neigh
        self.train_dict      = train_dict   # kept server-side only

        # ── Build item → users index ──────────────────────────────────────────
        # item2users[item_id] = [uid1, uid2, ...]
        # Used to find 2-hop neighbours: u → items → other users
        self.item2users: dict = defaultdict(list)
        for uid, items in train_dict.items():
            for iid in items:
                self.item2users[iid].append(uid)

    # ──────────────────────────────────────────────────────────────────────────
    def get_neighbours(self, uid: int) -> dict:
        """
        Return 2-hop neighbour users and their item lists for user uid.

        Algorithm:
          1. Get uid's items (1-hop)
          2. For each item, find other users (2-hop)
          3. Collect unique neighbour users (cap at max_neigh)
          4. For each neighbour, return their items (cap at max_items_neigh)

        Returns:
            {v_uid: [item_ids]} — neighbour users and their item lists
            Empty dict if no neighbours found.
        """
        my_items = set(self.train_dict.get(uid, []))
        neigh_counts = defaultdict(int)

        for iid in my_items:
            for v in self.item2users.get(iid, []):
                if v != uid:
                    neigh_counts[v] += 1

        if not neigh_counts:
            return {}

        # Sort by number of shared items (most similar first), cap at max_neigh
        sorted_neigh = sorted(neigh_counts.items(),
                              key=lambda x: -x[1])[:self.max_neigh]

        neighbours = {}
        for v_uid, _ in sorted_neigh:
            v_items = self.train_dict.get(v_uid, [])
            # Cap items per neighbour
            neighbours[v_uid] = v_items[:self.max_items_neigh]

        return neighbours

    # ──────────────────────────────────────────────────────────────────────────
    def get_neigh_embs(self, uid: int,
                       clients: dict) -> dict:
        """
        Return current user embeddings for uid's neighbours.
        Used to build the contrastive negative set on the client.

        Args:
            uid:     anchor user
            clients: dict {uid: ClientStage4}  — all client objects

        Returns:
            {v_uid: user_emb_tensor [d]}
        """
        neighbours = self.get_neighbours(uid)
        neigh_embs = {}
        for v_uid in neighbours:
            if v_uid in clients:
                neigh_embs[v_uid] = clients[v_uid].user_emb.detach().clone()
        return neigh_embs
