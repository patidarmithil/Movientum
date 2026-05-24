"""
contrastive.py  — STRUCTURAL CL (paper Eqs.5-7)
════════════════════════════════════════════════

User CL (Eq.5) — correct, unchanged:
  Query=e_u^(l), Positive=e_u^(0), Negatives=other users' layer-0

Item CL (Eq.6) — corrected from SimCLR to structural:
  Query=e_v^(l), Positive=e_v^(0), Negatives=other items' layer-0
  
  Variance guard: if all even-layer items are identical (no shared items
  in subgraph), CL returns zero — avoids degenerate maximum-entropy loss.
  
  Loss scaling: normalized by number of items to keep magnitude stable
  regardless of local dataset size. Prevents large clients dominating.
"""

import torch
import torch.nn.functional as F


def user_contrastive_loss(e0_all: torch.Tensor,
                          el_anchor: torch.Tensor,
                          tau: float = 0.2) -> torch.Tensor:
    """
    User-side structural contrastive loss (paper Eq.5).
    Query = e_u^(l), Positive = e_u^(0), Negatives = other users' layer-0.
    Requires N ≥ 3 (anchor + ≥2 neighbours).
    """
    N = e0_all.shape[0]
    if N < 3:
        return torch.tensor(0.0, device=e0_all.device, requires_grad=True)

    e0_norm  = F.normalize(e0_all, dim=1)
    el_norm  = F.normalize(el_anchor.unsqueeze(0), dim=1).squeeze(0)

    pos_sim  = (el_norm * e0_norm[0]).sum()
    neg_sims = (el_norm.unsqueeze(0) * e0_norm[1:]).sum(dim=1)

    all_logits = torch.cat([pos_sim.unsqueeze(0), neg_sims]) / tau
    return -(pos_sim / tau - torch.logsumexp(all_logits, dim=0))


def item_contrastive_loss(E_pos_l: torch.Tensor,
                          E_pos_0: torch.Tensor,
                          tau: float = 0.2) -> torch.Tensor:
    """
    Item-side structural contrastive loss (paper Eq.6).

    Query  = E_pos_l [n, d]  even-layer item embeddings (has gradient)
    Keys   = E_pos_0 [n, d]  layer-0 item embeddings (detached reference)
    sim[v,n] = e_v^(l) · e_n^(0) / τ
    Loss = cross-entropy(sim, diagonal)

    VARIANCE GUARD:
      If even-layer embeddings are all identical (no shared items in subgraph),
      the loss equals log(n) for every item regardless of parameters — this
      creates random gradients that fight BPR. We detect this and return zero.

    LOSS NORMALIZATION:
      Cross-entropy already averages over n items, so the loss magnitude is
      independent of local dataset size. No additional scaling needed.
    """
    n = E_pos_l.shape[0]
    if n < 2:
        return torch.tensor(0.0, device=E_pos_l.device, requires_grad=True)

    # Variance guard — no .item() call, stays on GPU
    item_std = E_pos_l.std(dim=0).mean()    # scalar tensor
    if item_std < 1e-6:
        # All even-layer embeddings identical → degenerate CL → skip
        return torch.tensor(0.0, device=E_pos_l.device, requires_grad=True)

    q = F.normalize(E_pos_l, dim=1)                  # [n, d] queries (even-layer)
    k = F.normalize(E_pos_0.detach(), dim=1)          # [n, d] keys (layer-0)

    sim_matrix = torch.mm(q, k.t()) / tau             # [n, n]
    labels     = torch.arange(n, device=E_pos_l.device)
    return F.cross_entropy(sim_matrix, labels)


def structural_contrastive_loss(e0_all:   torch.Tensor,
                                el_anchor: torch.Tensor,
                                E_pos_l:   torch.Tensor,
                                E_pos_0:   torch.Tensor,
                                beta1:     float = 0.1,
                                lam:       float = 1.0,
                                tau:       float = 0.2) -> tuple:
    """
    Full structural contrastive loss (paper Eq.7).
    L_con = β₁ · (L_Con^U + λ · L_Con^V)
    """
    l_user = user_contrastive_loss(e0_all, el_anchor, tau)
    l_item = item_contrastive_loss(E_pos_l, E_pos_0, tau)
    total  = beta1 * (l_user + lam * l_item)
    return total, l_user, l_item
