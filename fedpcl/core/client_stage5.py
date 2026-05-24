"""client_stage5.py — Stage 4 + LDP (paper Eq.9)."""
import torch
from core.client_stage4 import ClientStage4


def apply_ldp(g: torch.Tensor, sigma: float, lam: float) -> torch.Tensor:
    return torch.clamp(g, -sigma, sigma) + torch.distributions.Laplace(
        torch.zeros_like(g), lam).sample()


class ClientStage5(ClientStage4):
    def local_train(self, E_personal, neigh_embs, n_layers, local_epochs,
                    lr_item, lr_user, weight_decay,
                    use_cl=True, beta1=0.1, lam=1.0, tau=0.3, drop_rate=0.1,
                    use_ldp=True, clip_sigma=0.1, lambda_laplace=0.001):
        deltas, loss, emb = super().local_train(
            E_personal, neigh_embs, n_layers, local_epochs,
            lr_item, lr_user, weight_decay, use_cl, beta1, lam, tau, drop_rate)
        if not use_ldp:
            return deltas, loss, emb
        return ({iid: apply_ldp(d, clip_sigma, lambda_laplace) for iid, d in deltas.items()},
                loss,
                apply_ldp(emb, clip_sigma, lambda_laplace))
