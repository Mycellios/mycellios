"""Opt-in host vocabulary lookup for memory-limited accelerator stages."""
import torch
from torch import nn
from torch.nn import functional as F


class HostTokenEmbedding(nn.Embedding):
    def __init__(self, original: nn.Embedding, device, dtype):
        nn.Module.__init__(self)
        if original.weight.device.type != "cpu" or original.weight.dtype != dtype:
            raise ValueError("host token lookup requires checkpoint weights in CPU compute dtype")
        if original.max_norm is not None or original.training:
            raise ValueError("host token lookup requires immutable evaluation embedding")
        for name in ("num_embeddings", "embedding_dim", "padding_idx", "max_norm",
                     "norm_type", "scale_grad_by_freq", "sparse"):
            setattr(self, name, getattr(original, name))
        self.weight = original.weight
        self.training = False
        self.output_device, self.output_dtype = device, dtype
        self.version = self.weight._version

    def _apply(self, fn, recurse=True):
        probe = fn(torch.ones(1, dtype=self.weight.dtype))
        if probe.dtype != self.output_dtype:
            raise ValueError("host lookup compute dtype is sealed")
        return self

    def forward(self, ids):
        if self.training or self.weight._version != self.version:
            raise RuntimeError("host lookup weights must remain immutable")
        return F.embedding(ids.to("cpu"), self.weight, self.padding_idx,
                           None, self.norm_type, self.scale_grad_by_freq,
                           self.sparse).to(self.output_device, dtype=self.output_dtype)


def install_host_token_lookup(model, device, dtype):
    embedding = model.model.embed_tokens
    if not isinstance(embedding, nn.Embedding):
        raise ValueError("host token lookup requires an embedding endpoint")
    if any(parameter is embedding.weight for parameter in model.lm_head.parameters()):
        raise ValueError("host token lookup cannot retain a shared output head")
    replacement = HostTokenEmbedding(embedding, device, dtype)
    model.model.embed_tokens = replacement
    return {id(replacement.weight)}, replacement.weight.numel() * replacement.weight.element_size()
