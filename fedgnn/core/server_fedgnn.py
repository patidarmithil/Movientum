"""
server_fedgnn.py
════════════════
Server logic: Graph expansion + Gradient Aggregation.

Differences:
  - Aggregates true gradients (g_m and g_e) instead of deltas.
  - Updates E_global and GAT_global using an optimizer (SGD/Adam).
"""

import math
import random
import torch
import torch.nn as nn

from collections import defaultdict
from core.gat import FedGNN_GAT


class ServerFedGNN:
    def __init__(self, n_items: int, embed_dim: int,
                 train_dict: dict, device: torch.device,
                 n_layers: int = 2):
        self.n_items = n_items
        self.d       = embed_dim
        self.dev     = device

        limit = math.sqrt(6.0 / (1 + embed_dim))
        self.E_global = torch.empty(n_items, embed_dim, device=device).uniform_(-limit, limit)
        
        # Global GAT model
        self.gat_global = FedGNN_GAT(embed_dim, n_layers=n_layers).to(device)

        # Build item2users index for graph expansion
        self._item2users = defaultdict(list)
        for uid, items in train_dict.items():
            for iid in items:
                self._item2users[iid].append(uid)

        self._neighbours = {}

    def get_embeddings(self) -> torch.Tensor:
        """Returns the full global item embedding table."""
        return self.E_global

    def get_gat_state(self) -> dict:
        """Returns the state dict of the global GAT model."""
        return self.gat_global.state_dict()

    def select_clients(self, all_ids: list, k: int) -> list:
        if len(all_ids) <= k:
            return all_ids
        return random.sample(all_ids, k)

    def run_graph_expansion(self, clients: dict, max_neigh: int = 20):
        """
        One-time privacy-preserving graph expansion.
        """
        for uid, client in clients.items():
            # Find users who interacted with ANY item this client interacted with
            neigh_set = set()
            for iid in client.train_items:
                neigh_set.update(self._item2users[iid])
            
            neigh_set.discard(uid)
            neigh_list = list(neigh_set)
            
            if len(neigh_list) > max_neigh:
                neigh_list = random.sample(neigh_list, max_neigh)
                
            self._neighbours[uid] = neigh_list

    def get_neigh_embeddings(self, uid: int, clients: dict) -> torch.Tensor:
        """
        Server sends neighbour user embeddings to client.
        """
        n_ids = self._neighbours.get(uid, [])
        if not n_ids:
            return None
        embs = [clients[nid].user_emb for nid in n_ids if nid in clients]
        if not embs:
            return None
        return torch.stack(embs).detach().to(self.dev)

    def aggregate_gradients(self, selected_ids: list,
                            g_m_list: list,
                            g_e_list: list,
                            sizes: dict,
                            lr_item: float,
                            lr_model: float):
        """
        Aggregate gradients from clients and update global parameters.
        """
        total_weight = 0.0
        
        # Accumulate item gradients
        g_e_sum = defaultdict(lambda: torch.zeros(self.d, device=self.dev))
        g_e_count = defaultdict(float)
        
        # Accumulate model gradients
        g_m_sum = {name: torch.zeros_like(param) 
                   for name, param in self.gat_global.named_parameters()}
        
        for uid, g_m, g_e in zip(selected_ids, g_m_list, g_e_list):
            m_u = float(sizes.get(uid, 1))
            total_weight += m_u
            
            # Item grads
            for iid, grad in g_e.items():
                g_e_sum[iid] += m_u * grad.to(self.dev)
                g_e_count[iid] += m_u
                
            # Model grads
            for name, grad in g_m.items():
                g_m_sum[name] += m_u * grad.to(self.dev)
                
        if total_weight == 0:
            return

        # ── Update E_global ──
        for iid, grad_sum in g_e_sum.items():
            # Average the gradient
            avg_grad = grad_sum / g_e_count[iid]
            # SGD step (theta = theta - lr * grad)
            self.E_global[iid] -= lr_item * avg_grad

        # ── Update GAT_global ──
        # Here we just do manual SGD for simplicity and consistency
        with torch.no_grad():
            for name, param in self.gat_global.named_parameters():
                avg_grad = g_m_sum[name] / total_weight
                param.sub_(lr_model * avg_grad)
