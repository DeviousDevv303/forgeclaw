"""NEXUS Intelligence step 4 prep: a small decoder-only transformer. PROPOSED architecture, not evidence of anything.

Presets: `smoke` (pipeline test), `small` (CPU-trainable), `nexus-30m` (the directive's 8-12 layer / d_model ~512 / 30-60M target, here at the low end).
Learned positions, pre-LayerNorm, GELU, tied input/output embeddings. No KV cache (sequences are short).
`copy=True` adds a pointer-generator copy head: the next-token distribution is g * softmax(vocab logits) + (1 - g) * attention over the
tokens already in context, so a call can carry the user's own words (run 4 could not copy unseen words). Trained on the exact mixture
likelihood (`loss`); decoded through `next_logprobs`. With copy=False both reduce to the plain model."""
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
    copy: bool = False
    induction: bool = False  # with copy: boost copying position j when the token before j equals the current token (span copy)


PRESETS = {
    "smoke": Config(n_layer=2, n_head=4, d_model=128, d_ff=512, ctx=384),
    # small: a CPU-trainable step between smoke and the target; 640 positions fit the longest domain-suite context (573 tokens, tokenizer v1)
    "small": Config(n_layer=4, n_head=4, d_model=256, d_ff=1024, ctx=640),
    "small-copy": Config(n_layer=4, n_head=4, d_model=256, d_ff=1024, ctx=640, copy=True),
    "small-copy-ind": Config(n_layer=4, n_head=4, d_model=256, d_ff=1024, ctx=640, copy=True, induction=True),
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
        if c.copy:
            self.copy_q, self.copy_k = nn.Linear(c.d_model, c.d_model), nn.Linear(c.d_model, c.d_model)
            self.copy_gate = nn.Linear(c.d_model, 1)
            if c.induction:
                self.ind_w = nn.Parameter(torch.tensor(2.0))
        self.apply(self._init)

    @staticmethod
    def _init(m):
        if isinstance(m, (nn.Linear, nn.Embedding)):
            nn.init.normal_(m.weight, mean=0.0, std=0.02)
        if isinstance(m, nn.Linear) and m.bias is not None:
            nn.init.zeros_(m.bias)

    def hidden(self, idx):
        t = idx.shape[1]
        assert t <= self.c.ctx, f"sequence {t} longer than context {self.c.ctx}"
        x = self.tok(idx) + self.pos(torch.arange(t, device=idx.device))
        for blk in self.blocks:
            x = blk(x)
        return self.ln(x)

    def forward(self, idx):
        return self.hidden(idx) @ self.tok.weight.T  # tied output embedding (the generation side only)

    def _copy_parts(self, h, idx):
        """Attention of every position over itself and earlier positions (causal), and the generate gate g. With induction, position j
        gets a learned bonus when the token just before it equals the current token: having copied token j-1, continue with token j."""
        t = h.shape[1]
        scores = (self.copy_q(h) @ self.copy_k(h).transpose(1, 2)) / math.sqrt(h.shape[-1])
        if self.c.induction:
            prev = torch.cat([torch.full_like(idx[:, :1], -1), idx[:, :-1]], 1)  # prev[j] = idx[j-1]
            scores = scores + self.ind_w * (prev.unsqueeze(1) == idx.unsqueeze(2)).to(scores.dtype)
        scores = scores.masked_fill(torch.ones(t, t, dtype=torch.bool, device=h.device).triu(1), float("-inf"))
        return scores.softmax(-1), torch.sigmoid(self.copy_gate(h)).squeeze(-1)

    def loss(self, idx, y):
        """Mean NLL of the targets y (-100 = ignored). Plain cross-entropy without copy; the exact mixture likelihood with it."""
        h = self.hidden(idx)
        logits = h @ self.tok.weight.T
        if not self.c.copy:
            return F.cross_entropy(logits.view(-1, logits.shape[-1]), y.view(-1), ignore_index=-100)
        valid = y != -100
        yc = y.clamp(min=0)
        p_gen = logits.log_softmax(-1).gather(-1, yc.unsqueeze(-1)).squeeze(-1).exp()
        attn, g = self._copy_parts(h, idx)
        p_copy = (attn * (idx.unsqueeze(1) == yc.unsqueeze(2))).sum(-1)  # mass on earlier tokens equal to the target
        p = g * p_gen + (1 - g) * p_copy
        return -(torch.log(p.clamp_min(1e-9)) * valid).sum() / valid.sum().clamp_min(1)

    @torch.no_grad()
    def next_logprobs(self, ids):
        """Log-probabilities of the next token after `ids` (a list), including the copy distribution when copy=True."""
        x = torch.tensor([ids[-self.c.ctx:]])
        h = self.hidden(x)
        lp = (h[0, -1] @ self.tok.weight.T).log_softmax(-1)
        if not self.c.copy:
            return lp
        attn, g = self._copy_parts(h, x)
        p_copy = torch.zeros_like(lp).scatter_add_(0, x[0], attn[0, -1])
        return torch.log((g[0, -1] * lp.exp() + (1 - g[0, -1]) * p_copy).clamp_min(1e-12))

    def n_params(self) -> int:
        return sum(p.numel() for p in self.parameters())

    @torch.no_grad()
    def greedy(self, ids, stop_ids, max_new=200):
        self.eval()
        out = list(ids)
        for _ in range(max_new):
            nxt = int(self.next_logprobs(out).argmax())
            out.append(nxt)
            if nxt in stop_ids:
                break
        return out[len(ids):]
