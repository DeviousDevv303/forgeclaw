"""NEXUS Intelligence step 4 prep: a small decoder-only transformer. PROPOSED architecture, not evidence of anything.

Presets: `smoke` (pipeline test), `small` (CPU-trainable), `nexus-30m` (the directive's 8-12 layer / d_model ~512 / 30-60M target, here at the low end).
Learned positions, pre-LayerNorm, GELU, tied input/output embeddings. No KV cache (sequences are short)."""
import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


@dataclass
class Config:
    vocab_size: int = 4000
    n_layer: int = 8
    n_head: int = 8
    d_model: int = 512
    d_ff: int = 2048
    ctx: int = 512
    dropout: float = 0.0


PRESETS = {
    "smoke": Config(n_layer=2, n_head=4, d_model=128, d_ff=512, ctx=384),
    # small: a CPU-trainable step between smoke and the target; 640 positions fit the longest domain-suite context (573 tokens, tokenizer v1)
    "small": Config(n_layer=4, n_head=4, d_model=256, d_ff=1024, ctx=640),
    "nexus-30m": Config(n_layer=8, n_head=8, d_model=512, d_ff=2048, ctx=640),
}


class Block(nn.Module):
    def __init__(self, c: Config):
        super().__init__()
        self.ln1, self.ln2 = nn.LayerNorm(c.d_model), nn.LayerNorm(c.d_model)
        self.qkv = nn.Linear(c.d_model, 3 * c.d_model)
        self.proj = nn.Linear(c.d_model, c.d_model)
        self.ff = nn.Sequential(nn.Linear(c.d_model, c.d_ff), nn.GELU(), nn.Linear(c.d_ff, c.d_model))
        self.n_head, self.drop = c.n_head, c.dropout

    def forward(self, x):
        b, t, d = x.shape
        q, k, v = self.qkv(self.ln1(x)).split(d, dim=2)
        q, k, v = (z.view(b, t, self.n_head, d // self.n_head).transpose(1, 2) for z in (q, k, v))
        a = F.scaled_dot_product_attention(q, k, v, is_causal=True, dropout_p=self.drop if self.training else 0.0)
        x = x + self.proj(a.transpose(1, 2).contiguous().view(b, t, d))
        return x + self.ff(self.ln2(x))


class NexusLM(nn.Module):
    def __init__(self, c: Config):
        super().__init__()
        self.c = c
        self.tok = nn.Embedding(c.vocab_size, c.d_model)
        self.pos = nn.Embedding(c.ctx, c.d_model)
        self.blocks = nn.ModuleList(Block(c) for _ in range(c.n_layer))
        self.ln = nn.LayerNorm(c.d_model)
        self.apply(self._init)

    @staticmethod
    def _init(m):
        if isinstance(m, (nn.Linear, nn.Embedding)):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)
        if isinstance(m, nn.Linear) and m.bias is not None:
            nn.init.zeros_(m.bias)

    def forward(self, idx):
        t = idx.shape[1]
        assert t <= self.c.ctx, f"sequence {t} longer than context {self.c.ctx}"
        x = self.tok(idx) + self.pos(torch.arange(t, device=idx.device))
        for blk in self.blocks:
            x = blk(x)
        return self.ln(x) @ self.tok.weight.T  # tied output embedding

    def n_params(self) -> int:
        return sum(p.numel() for p in self.parameters())

    @torch.no_grad()
    def greedy(self, ids, stop_ids, max_new=200):
        self.eval()
        out = list(ids)
        for _ in range(max_new):
            x = torch.tensor([out[-self.c.ctx:]])
            nxt = int(self(x)[0, -1].argmax())
            out.append(nxt)
            if nxt in stop_ids:
                break
        return out[len(ids):]
