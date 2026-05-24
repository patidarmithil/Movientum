"""
client_stage4.py  — STRUCTURAL CL, WEIGHTS PRECOMPUTED
════════════════════════════════════════════════════════
PERFORMANCE BUG FIXED:
  Previous version called _build_shared_weights() inside _lightgcn_expanded
  at EVERY training step. This had a Python loop with GPU→CPU .item() calls,
  making training 5-20x slower.

  Fix: all graph-structure-dependent weights are precomputed ONCE in __init__:
    self._w_anchor:   [n_pos]     anchor→item LightGCN weights (fixed)
    self._W_neigh:    [n_pos, M]  neighbour→item weights (fixed, sparse in practice)
    self._deg_item:   [n_pos]     item degrees (fixed)
    self._has_shared: bool        True if ≥1 shared item exists (skip CL if False)

  _lightgcn_expanded now does only tensor ops: no Python loops, no .item().

STRUCTURAL CL (paper Eq.6):
  Query  = e_v^(l)  even-layer item embedding (distinct per item if shared)
  Key    = e_v^(0)  layer-0 item embedding (E_pos, used as reference)
  Negatives = other items' layer-0 embeddings
  Loss   = cross-entropy on [n_items × n_items] similarity matrix

  This ONLY works when e_v^(l) differs across items.
  Shared items (in anchor AND ≥1 neighbour's list) get distinct e_v^(l).
  Non-shared items all get identical e_v^(l) = fn(e_u^(l)) — degenerate.
  The degenerate variance check in contrastive.py skips item CL when all
  even-layer embeddings are identical (graceful fallback to user CL only).
"""

import math
import random
import torch
import torch.nn.functional as F

from core.contrastive import structural_contrastive_loss


class ClientStage4:

    def __init__(self, uid: int,
                 train_items: list,
                 neighbour_users: dict,
                 n_items: int,
                 embed_dim: int,
                 device: torch.device):
        self.uid             = uid
        self.train_items     = train_items
        self._train_set      = set(train_items)
        self.neighbour_users = neighbour_users
        self.n_items         = n_items
        self.d               = embed_dim
        self.dev             = device
        self.n               = len(train_items)
        self.neigh_uids      = list(neighbour_users.keys())
        self.M               = len(self.neigh_uids)

        limit = math.sqrt(6.0 / (1 + embed_dim))
        self.user_emb    = torch.empty(embed_dim, device=device).uniform_(-limit, limit)
        self.neigh_embs: dict = {}

        self.m = torch.zeros(embed_dim, device=device)
        self.v = torch.zeros(embed_dim, device=device)
        self.t = 0

        # Precompute all graph structure weights — called ONCE, used every step
        self._precompute_graph_weights()

    # ──────────────────────────────────────────────────────────────────────────
    def _precompute_graph_weights(self):
        """
        Precompute all LightGCN weights for the expanded subgraph.
        Called once in __init__. O(n_items × M) — negligible vs training cost.

        Stores:
          _item_extra:   list[list[int]]  for each anchor item, which neigh indices share it
          _deg_item:     [n_pos] float tensor  degree of each anchor item
          _w_anchor:     [n_pos] float tensor  anchor normalisation weight per item
          _W_neigh:      [n_pos, M] float tensor  neighbour contribution weights (sparse)
          _has_shared:   bool  True if any item has ≥1 neighbour sharing it
        """
        n   = self.n
        M   = self.M
        dev = self.dev

        # Which neighbour users share each anchor item
        item_extra = [[] for _ in range(n)]
        if M > 0:
            for vi, v_uid in enumerate(self.neigh_uids):
                v_set = set(self.neighbour_users.get(v_uid, []))
                for ai, iid in enumerate(self.train_items):
                    if iid in v_set:
                        item_extra[ai].append(vi)
        self._item_extra = item_extra

        n_extra = torch.tensor([len(x) for x in item_extra],
                               dtype=torch.float32, device=dev)   # [n]
        deg_item = 1.0 + n_extra                                   # [n]
        self._deg_item = deg_item

        # Anchor user degree = n_pos (interacts with all anchor items)
        deg_u = float(n)

        # Anchor→item weight: 1/√(deg_u × deg_item[i])
        self._w_anchor = 1.0 / (math.sqrt(deg_u) * deg_item.sqrt())  # [n]

        # Neighbour→item weight matrix [n, M]
        self._W_neigh = torch.zeros(n, M, device=dev)
        if M > 0:
            neigh_degs = torch.tensor(
                [max(float(len(self.neighbour_users.get(v, []))), 1.0)
                 for v in self.neigh_uids],
                dtype=torch.float32, device=dev
            )  # [M]
            for ai, extra in enumerate(item_extra):
                for vi in extra:
                    self._W_neigh[ai, vi] = 1.0 / (
                        neigh_degs[vi].sqrt() * deg_item[ai].sqrt()
                    )

        self._has_shared = any(len(x) > 0 for x in item_extra)

    # ──────────────────────────────────────────────────────────────────────────
    def local_train(self,
                    E_personal:    torch.Tensor,
                    neigh_embs:    dict,
                    n_layers:      int,
                    local_epochs:  int,
                    lr_item:       float,
                    lr_user:       float,
                    weight_decay:  float,
                    use_cl:        bool   = True,
                    beta1:         float  = 0.1,
                    lam:           float  = 1.0,
                    tau:           float  = 0.3,
                    drop_rate:     float  = 0.1) -> tuple:

        if self.n < 2:
            return {}, float('inf'), self.user_emb.detach().clone()

        self.neigh_embs = neigh_embs
        pos_ids = self.train_items
        E_local = E_personal[pos_ids].detach().clone()

        total_loss = 0.0

        for _ in range(local_epochs):
            neg_ids = []
            for _ in pos_ids:
                while True:
                    j = random.randint(0, self.n_items - 1)
                    if j not in self._train_set:
                        neg_ids.append(j)
                        break

            E_pos  = E_local.clone().requires_grad_(True)
            E_neg  = E_personal[neg_ids].detach().clone().requires_grad_(True)
            e_u    = self.user_emb.clone().requires_grad_(True)
            neigh_e0 = self._get_neigh_e0()

            layers_u, layers_i, e_u_agg = self._lightgcn_expanded(
                e_u, E_pos, neigh_e0, n_layers
            )

            n_pairs    = min(self.n, len(neg_ids))
            pos_scores = (e_u_agg * E_pos[:n_pairs]).sum(dim=1)
            neg_scores = (e_u_agg * E_neg[:n_pairs]).sum(dim=1)
            loss_bpr   = -F.logsigmoid(pos_scores - neg_scores).mean()

            loss_reg = weight_decay * (
                (e_u ** 2).sum() + (E_pos ** 2).sum() / max(self.n, 1)
            )

            loss_cl = torch.tensor(0.0, device=self.dev)
            if use_cl and len(layers_u) > 2:
                e_u_l2  = layers_u[-1]    # even-layer anchor user
                E_pos_l = layers_i[-1]    # even-layer items [n, d]
                E_pos_0 = E_pos           # layer-0 items   [n, d]
                e0_all  = self._build_e0_all(e_u, neigh_e0)   # [1+M, d]

                loss_cl, _, _ = structural_contrastive_loss(
                    e0_all    = e0_all,
                    el_anchor = e_u_l2,
                    E_pos_l   = E_pos_l,
                    E_pos_0   = E_pos_0,
                    beta1     = beta1,
                    lam       = lam,
                    tau       = tau,
                )

            loss = loss_bpr + loss_reg + loss_cl
            loss.backward()
            total_loss += float(loss.detach())

            if E_pos.grad is not None:
                E_local = (E_local - lr_item * E_pos.grad.detach()).detach()

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

        E_orig      = E_personal[pos_ids].detach()
        deltas      = E_local - E_orig
        item_deltas = {iid: deltas[idx].clone()
                       for idx, iid in enumerate(pos_ids)}

        return item_deltas, total_loss / max(local_epochs, 1), \
               self.user_emb.detach().clone()

    # ──────────────────────────────────────────────────────────────────────────
    def _get_neigh_e0(self) -> torch.Tensor:
        embs = [self.neigh_embs[v] for v in self.neigh_uids if v in self.neigh_embs]
        if not embs:
            return None
        return torch.stack(embs).to(self.dev)

    def _build_e0_all(self, e_u, neigh_e0) -> torch.Tensor:
        if neigh_e0 is None or neigh_e0.shape[0] == 0:
            return e_u.unsqueeze(0)
        return torch.cat([e_u.unsqueeze(0), neigh_e0.detach()], dim=0)

    # ──────────────────────────────────────────────────────────────────────────
    def _lightgcn_expanded(self, e_u, E_pos, neigh_e0, n_layers):
        """
        Expanded LightGCN with precomputed weights.
        No Python loops, no .item() calls — pure tensor ops.

        Item propagation (per layer):
          e_i^(l+1) = w_anchor[i]*e_u^(l) + Σ_{vi shares i} W_neigh[i,vi]*e_v^(0)

        User propagation (per layer):
          e_u^(l+1) = (1/√deg_u) * Σ_i e_i^(l)  (standard LightGCN)

        Even-layer user update incorporates neighbour user mean (for user CL).
        """
        n_pos = E_pos.shape[0]
        if n_pos == 0:
            return [e_u], [E_pos], e_u

        M   = neigh_e0.shape[0] if (neigh_e0 is not None and
                                      neigh_e0.shape[0] > 0) else 0
        deg_u = float(n_pos)

        # Precomputed structural weights (all tensors, no Python loops)
        w_anchor = self._w_anchor    # [n_pos]
        W_neigh  = self._W_neigh     # [n_pos, M]

        # Compute static neighbour contribution to items ONCE per forward pass
        # [n_pos, d] = [n_pos, M] @ [M, d]  — only nonzero where item is shared
        if M > 0 and neigh_e0 is not None and self._has_shared:
            static_neigh = torch.mm(W_neigh[:, :M], neigh_e0.detach())  # [n_pos, d]
        else:
            static_neigh = None

        layers_u = [e_u]
        layers_i = [E_pos]
        e_uk, E_ik = e_u, E_pos

        for layer in range(n_layers):
            # User aggregates from items (standard normalisation 1/√deg_u)
            new_eu = (1.0 / math.sqrt(deg_u)) * E_ik.sum(dim=0)  # [d]

            # Items aggregate from anchor user + shared neighbours
            # w_anchor[i] * e_u^(l)  →  [n_pos, 1] * [1, d] broadcast
            new_Ei = w_anchor.unsqueeze(1) * e_uk.unsqueeze(0)    # [n_pos, d]

            # Add static neighbour contribution (constant across layers —
            # neighbours contribute their layer-0 embeddings per LightGCN
            # approximation for the federated single-anchor setting)
            if static_neigh is not None:
                new_Ei = new_Ei + static_neigh

            # Even-layer: enrich user with neighbour user mean (for user CL)
            if (layer + 1) % 2 == 0 and M > 0 and neigh_e0 is not None:
                u_norm   = 1.0 / math.sqrt(float(1 + M))
                new_eu   = u_norm * new_eu + u_norm * neigh_e0.detach().mean(dim=0)

            e_uk, E_ik = new_eu, new_Ei
            layers_u.append(e_uk)
            layers_i.append(E_ik)

        e_u_agg = torch.stack(layers_u).mean(dim=0)
        return layers_u, layers_i, e_u_agg

    # ──────────────────────────────────────────────────────────────────────────
    @torch.no_grad()
    def get_scores(self, E_personal: torch.Tensor, n_layers: int) -> torch.Tensor:
        if self.n == 0:
            return torch.zeros(self.n_items, device=self.dev)
        E_pos = E_personal[self.train_items]
        _, _, e_u_agg = self._lightgcn_expanded(self.user_emb, E_pos, None, n_layers)
        return (e_u_agg.unsqueeze(0) * E_personal).sum(dim=1)
