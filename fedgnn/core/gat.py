"""
gat.py
══════
Trainable Graph Attention Network (GAT) for FedGNN.
Matches paper requirement: learnable weight matrix W and attention vector a.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F
import math

class FedGNN_GAT(nn.Module):
    def __init__(self, embed_dim: int, n_layers: int = 2):
        super().__init__()
        self.d = embed_dim
        self.n_layers = n_layers
        
        # Learnable parameters for GAT
        self.W_layers = nn.ModuleList([
            nn.Linear(embed_dim, embed_dim, bias=False) for _ in range(n_layers)
        ])
        self.a_layers = nn.ParameterList([
            nn.Parameter(torch.empty(2 * embed_dim).uniform_(-0.1, 0.1)) for _ in range(n_layers)
        ])
        self.leaky_relu = nn.LeakyReLU(0.2)
        
        # Initialize W
        for w in self.W_layers:
            nn.init.xavier_uniform_(w.weight)

    def forward(self, e_u: torch.Tensor, E_pos: torch.Tensor, E_neigh: torch.Tensor = None):
        """
        Args:
            e_u: [d] user embedding
            E_pos: [n, d] positive items
            E_neigh: [m, d] neighbour users (optional)
        Returns:
            e_u_agg: [d] aggregated user embedding
        """
        n_pos = E_pos.shape[0]
        if n_pos == 0:
            return e_u
            
        e_uk = e_u
        E_ik = E_pos
        layers_u = [e_u]
        
        for l in range(self.n_layers):
            W = self.W_layers[l]
            a = self.a_layers[l]
            
            # Linear transformation
            h_u = W(e_uk)          # [d]
            h_i = W(E_ik)          # [n, d]
            h_n = W(E_neigh) if E_neigh is not None else None  # [m, d]
            
            # All neighbours of user
            if h_n is not None and h_n.shape[0] > 0:
                all_neigh = torch.cat([h_i, h_n], dim=0)  # [n+m, d]
            else:
                all_neigh = h_i
                
            # Attention scores: a^T [Wh_u || Wh_v]
            h_u_expand = h_u.unsqueeze(0).expand(all_neigh.shape[0], -1) # [n+m, d]
            concat_h = torch.cat([h_u_expand, all_neigh], dim=1)         # [n+m, 2d]
            raw_scores = self.leaky_relu((concat_h * a).sum(dim=1))      # [n+m]
            alpha = F.softmax(raw_scores, dim=0)                         # [n+m]
            
            # User update
            new_eu = (alpha.unsqueeze(1) * all_neigh).sum(dim=0)         # [d]
            # Rescale to prevent magnitude shrinking
            new_eu = new_eu * math.sqrt(float(all_neigh.shape[0]))
            
            # Item update (only attends to anchor user)
            new_Ei = h_u.unsqueeze(0).expand(n_pos, -1)                  # [n, d]
            
            e_uk, E_ik = new_eu, new_Ei
            layers_u.append(e_uk)
            
        e_u_agg = torch.stack(layers_u).mean(dim=0)
        return e_u_agg
