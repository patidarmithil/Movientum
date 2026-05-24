"""
client_fedgnn.py
════════════════
FedGNN client — Gradient sharing + LDP + GAT + Pseudo sampling.

Differences vs previous version:
  - TRUE gradient sharing (returns gradients, not deltas).
  - Collects model gradients (g_m) for the trainable GAT.
  - Collects item embedding gradients (g_e) for positive AND negative items.
  - Local Differential Privacy (LDP): gradient clipping + Laplace noise.
"""

import math
import random
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.distributions import Laplace

from core.gat import FedGNN_GAT


class ClientFedGNN:
    def __init__(self, uid: int, train_items: list,
                 n_items: int, embed_dim: int,
                 device: torch.device,
                 n_layers: int = 2):
        self.uid         = uid
        self.train_items = train_items
        self.n_items     = n_items
        self.d           = embed_dim
        self.dev         = device
        self.n           = len(train_items)
        self._train_set  = set(train_items)

        # ── User embedding ────────────────────────────────────────────────────
        limit = math.sqrt(6.0 / (1 + embed_dim))
        self.user_emb = torch.empty(embed_dim, device=device).uniform_(-limit, limit)

        # Adam state for user_emb
        self._m = torch.zeros(embed_dim, device=device)
        self._v = torch.zeros(embed_dim, device=device)
        self._t = 0

        # Neighbour embeddings
        self._neigh_embs: torch.Tensor = None

        # Local GAT instantiation (weights copied from server each round)
        self._gat = FedGNN_GAT(embed_dim=embed_dim, n_layers=n_layers).to(device)

    def set_neigh_embeddings(self, embs: torch.Tensor) -> None:
        if embs is not None:
            self._neigh_embs = embs.detach().to(self.dev)

    def local_train(self, E_global: torch.Tensor,
                    global_gat_state: dict,
                    lr_user: float,
                    weight_decay: float,
                    pseudo_m: int = 100,
                    clip_norm: float = 1.0,
                    laplace_lambda: float = 0.01) -> tuple:
        """
        FedGNN gradient computation with LDP.
        """
        if self.n < 1:
            return None, None, float('inf')

        # 1. Sync local GAT with global model
        self._gat.load_state_dict(global_gat_state)
        self._gat.train()

        pos_ids = self.train_items
        E_local = E_global[pos_ids].detach().clone().requires_grad_(True)
        
        # Sample negatives (1 for each pos)
        neg_ids = []
        for _ in pos_ids:
            while True:
                j = random.randint(0, self.n_items - 1)
                if j not in self._train_set:
                    neg_ids.append(j)
                    break
        E_neg = E_global[neg_ids].detach().clone().requires_grad_(True)
        e_u = self.user_emb.clone().requires_grad_(True)

        # Forward pass
        e_u_agg = self._gat(e_u, E_local, self._neigh_embs)

        # BPR loss
        n_pairs = min(self.n, len(neg_ids))
        pos_scores = (e_u_agg * E_local[:n_pairs]).sum(dim=1)
        neg_scores = (e_u_agg * E_neg[:n_pairs]).sum(dim=1)
        loss_bpr = -F.logsigmoid(pos_scores - neg_scores).mean()
        
        loss_reg = weight_decay * ((e_u ** 2).sum() + (E_local ** 2).sum() / max(self.n, 1))
        loss = loss_bpr + loss_reg

        self._gat.zero_grad()
        loss.backward()

        # ── 1. Model Gradients (g_m) ──
        g_m = {}
        for name, param in self._gat.named_parameters():
            if param.grad is not None:
                g_m[name] = param.grad.detach().clone()

        # ── 2. Item Embedding Gradients (g_e) ──
        g_e = {}
        if E_local.grad is not None:
            for idx, iid in enumerate(pos_ids):
                if iid not in g_e:
                    g_e[iid] = torch.zeros_like(E_local.grad[idx])
                g_e[iid] += E_local.grad[idx].detach().clone()
                
        if E_neg.grad is not None:
            for idx, iid in enumerate(neg_ids):
                if iid not in g_e:
                    g_e[iid] = torch.zeros_like(E_neg.grad[idx])
                g_e[iid] += E_neg.grad[idx].detach().clone()

        # ── 3. LDP Privacy (Clipping + Laplace noise) ──
        # Clip and add noise to item embedding gradients
        for iid in list(g_e.keys()):
            grad = g_e[iid]
            norm = grad.norm(p=2)
            if norm > clip_norm:
                grad = grad / (norm / clip_norm)
            noise = Laplace(0, laplace_lambda).sample(grad.shape).to(self.dev)
            g_e[iid] = grad + noise

        # Clip and add noise to model gradients
        for name in list(g_m.keys()):
            grad = g_m[name]
            norm = grad.norm(p=2)
            if norm > clip_norm:
                grad = grad / (norm / clip_norm)
            noise = Laplace(0, laplace_lambda).sample(grad.shape).to(self.dev)
            g_m[name] = grad + noise

        # ── 4. Pseudo Item Sampling ──
        # Add M fake item gradients from Normal(mu, std)
        if len(g_e) > 0 and pseudo_m > 0:
            real_tensors = torch.stack(list(g_e.values()))
            if real_tensors.shape[0] > 1:
                mu = real_tensors.mean(dim=0)
                std = real_tensors.std(dim=0).clamp(min=1e-6)
            else:
                mu = real_tensors[0]
                std = torch.ones_like(mu) * 1e-6
                
            all_non_train = list(set(range(self.n_items)) - self._train_set)
            m_actual = min(pseudo_m, len(all_non_train))
            pseudo_ids = random.sample(all_non_train, m_actual)
            
            for iid in pseudo_ids:
                g_e[iid] = torch.normal(mean=mu, std=std).to(self.dev)

        # ── Update user embedding locally (Adam) ──
        if e_u.grad is not None:
            g = e_u.grad.detach()
            self._t += 1
            b1, b2, eps = 0.9, 0.999, 1e-8
            self._m = b1 * self._m + (1 - b1) * g
            self._v = b2 * self._v + (1 - b2) * g ** 2
            m_hat = self._m / (1 - b1 ** self._t)
            v_hat = self._v / (1 - b2 ** self._t)
            self.user_emb = (self.user_emb - lr_user * m_hat / (v_hat.sqrt() + eps)).detach()

        return g_m, g_e, float(loss.detach())

    @torch.no_grad()
    def get_scores(self, E_global: torch.Tensor, global_gat_state: dict) -> torch.Tensor:
        """Score ALL items for evaluation."""
        if self.n == 0:
            return torch.zeros(self.n_items, device=self.dev)
        self._gat.load_state_dict(global_gat_state)
        self._gat.eval()
        E_pos = E_global[self.train_items]
        e_u_agg = self._gat(self.user_emb, E_pos, self._neigh_embs)
        return (e_u_agg.unsqueeze(0) * E_global).sum(dim=1)
