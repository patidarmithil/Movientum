"""
client_stage3.py
════════════════
Stage 3 client — adds personalized model support.

Changes from Stage 2 (client.py):
  RECEIVE:  E_personal = μ1*E_cluster + μ2*E_global  (instead of E_global)
  SEND:     item_deltas + user_emb  (Stage 2 only sent item_deltas)

Everything else (local LightGCN, BPR, Adam for user_emb) is identical.

Privacy note:
  user_emb is shared with the server ONLY for clustering.
  The server uses it for K-means assignment, not for recommendation.
  This is the same design as FedPCL paper Section III-C.
"""

import math
import random
import torch
import torch.nn.functional as F


class ClientStage3:
    """
    Federated client for Stage 3 (personalized FedAvg).

    Args:
        uid:         user integer ID
        train_items: list of item IDs (private)
        n_items:     total number of items
        embed_dim:   d
        device:      torch device
    """

    def __init__(self, uid: int, train_items: list,
                 n_items: int, embed_dim: int,
                 device: torch.device):
        self.uid         = uid
        self.train_items = train_items
        self.n_items     = n_items
        self.d           = embed_dim
        self.dev         = device
        self.n           = len(train_items)
        self._train_set  = set(train_items)

        # ── User embedding — shared with server for clustering only ───────────
        limit = math.sqrt(6.0 / (1 + embed_dim))
        self.user_emb = torch.empty(embed_dim, device=device).uniform_(-limit, limit)

        # Adam state for user_emb
        self.m = torch.zeros(embed_dim, device=device)
        self.v = torch.zeros(embed_dim, device=device)
        self.t = 0

    # ──────────────────────────────────────────────────────────────────────────
    def local_train(self, E_personal: torch.Tensor,
                    n_layers: int,
                    local_epochs: int,
                    lr_item: float,
                    lr_user: float,
                    weight_decay: float) -> tuple:
        """
        FedAvg ClientUpdate on personalised embeddings.

        Identical to Stage 2 local_train EXCEPT:
          - receives E_personal (= μ1*E_cluster + μ2*E_global) instead of E_global
          - returns (item_deltas, avg_loss, user_emb)  — note extra user_emb

        The delta is still computed as:
          delta[i] = E_local_final[i] - E_personal[i]
        so the server can apply it to both global and cluster tables.

        Returns:
            item_deltas: dict {item_id: delta [d]}
            avg_loss:    float
            user_emb:    [d] tensor — sent to server for K-means clustering
        """
        if self.n < 2:
            return {}, float('inf'), self.user_emb.detach().clone()

        pos_ids = self.train_items
        E_local = E_personal[pos_ids].detach().clone()   # [n_pos, d]

        total_loss = 0.0

        for _ in range(local_epochs):
            # Sample negatives
            neg_ids = []
            for _ in pos_ids:
                while True:
                    j = random.randint(0, self.n_items - 1)
                    if j not in self._train_set:
                        neg_ids.append(j)
                        break

            # Leaf tensors
            E_pos = E_local.clone().requires_grad_(True)
            E_neg = E_personal[neg_ids].detach().clone().requires_grad_(True)
            e_u   = self.user_emb.clone().requires_grad_(True)

            # Local LightGCN
            _, _, e_u_agg = self._lightgcn(e_u, E_pos, n_layers)

            # BPR loss
            n_pairs    = min(self.n, len(neg_ids))
            pos_scores = (e_u_agg * E_pos[:n_pairs]).sum(dim=1)
            neg_scores = (e_u_agg * E_neg[:n_pairs]).sum(dim=1)
            loss_bpr   = -F.logsigmoid(pos_scores - neg_scores).mean()

            # L2 reg
            loss_reg = weight_decay * (
                (e_u   ** 2).sum() +
                (E_pos ** 2).sum() / max(self.n, 1)
            )
            loss = loss_bpr + loss_reg
            loss.backward()
            total_loss += float(loss.detach())

            # SGD on local item copy
            if E_pos.grad is not None:
                E_local = (E_local - lr_item * E_pos.grad.detach()).detach()

            # Adam on user_emb
            if e_u.grad is not None:
                g = e_u.grad.detach()
                self.t += 1
                b1, b2, eps = 0.9, 0.999, 1e-8
                self.m = b1 * self.m + (1 - b1) * g
                self.v = b2 * self.v + (1 - b2) * g ** 2
                m_hat  = self.m / (1 - b1 ** self.t)
                v_hat  = self.v / (1 - b2 ** self.t)
                self.user_emb = (
                    self.user_emb - lr_user * m_hat / (v_hat.sqrt() + eps)
                ).detach()

        # Delta vs personalised starting point
        E_orig  = E_personal[pos_ids].detach()
        deltas  = E_local - E_orig
        item_deltas = {iid: deltas[idx].clone()
                       for idx, iid in enumerate(pos_ids)}

        # Return user_emb for server-side clustering
        return item_deltas, total_loss / max(local_epochs, 1), \
               self.user_emb.detach().clone()

    # ──────────────────────────────────────────────────────────────────────────
    def _lightgcn(self, e_u, E_pos, n_layers):
        """LightGCN propagation on local subgraph (autograd-compatible)."""
        n_pos = E_pos.shape[0]
        if n_pos == 0:
            return [e_u], [E_pos], e_u
        norm = 1.0 / math.sqrt(float(n_pos))
        layers_u, layers_i = [e_u], [E_pos]
        e_uk, E_ik = e_u, E_pos
        for _ in range(n_layers):
            new_eu = norm * E_ik.sum(dim=0)
            new_Ei = (norm * e_uk).unsqueeze(0).expand(n_pos, -1)
            e_uk, E_ik = new_eu, new_Ei
            layers_u.append(e_uk)
            layers_i.append(E_ik)
        return layers_u, layers_i, torch.stack(layers_u).mean(dim=0)

    # ──────────────────────────────────────────────────────────────────────────
    @torch.no_grad()
    def get_scores(self, E_personal: torch.Tensor,
                   n_layers: int) -> torch.Tensor:
        """Score ALL items using personalised embeddings."""
        if self.n == 0:
            return torch.zeros(self.n_items, device=self.dev)
        E_pos = E_personal[self.train_items]
        _, _, e_u_agg = self._lightgcn(self.user_emb, E_pos, n_layers)
        return (e_u_agg.unsqueeze(0) * E_personal).sum(dim=1)
