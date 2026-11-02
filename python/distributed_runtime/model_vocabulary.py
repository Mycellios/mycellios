"""Construct a selective decoder without unused untied vocabulary allocations."""
from __future__ import annotations
from typing import Any,Callable
import torch
from torch import nn

def construct_selective_architecture(config: Any, spec: Any, adapter: Any, *, resident_dtype: torch.dtype, construct: Callable[..., Any], resident_device: torch.device | str | None = None):
    if resident_device is None:
        return _construct_selective_architecture(config, spec, adapter,
            resident_dtype=resident_dtype, construct=construct)
    device = torch.device(resident_device)
    if device.type not in ('cpu', 'cuda'):
        raise ValueError('selective construction device must be CPU or CUDA')
    # Placement is an internal primitive, not a memory admission grant. The
    # caller must authenticate and admit the complete stage before construction.
    with torch.device(device):
        return _construct_selective_architecture(config, spec, adapter,
            resident_dtype=resident_dtype, construct=construct)

def _construct_selective_architecture(config: Any, spec: Any, adapter: Any, *, resident_dtype: torch.dtype, construct: Callable[..., Any]):
    original_vocab_size = int(config.vocab_size)
    original_pad_token_id = getattr(config, 'pad_token_id', None)
    local_layers = spec.layer_end - spec.layer_start
    reduced_untied = (
        getattr(config, 'model_type', None) == 'qwen3'
        and not bool(getattr(config, 'tie_word_embeddings', False))
        and not (spec.first and spec.last)
    )
    reduced = (not spec.first and not spec.last) or reduced_untied
    if reduced:
        config.vocab_size = 1
        config.pad_token_id = 0
    if reduced_untied:
        # The certified untied Qwen3 checkpoint covers every owned parameter.
        # Avoid filling gigabytes with random values that are immediately
        # overwritten; rotary buffers are still constructed normally.
        try:
            from transformers.initialization import no_init_weights
        except ImportError:
            from transformers.modeling_utils import no_init_weights
        with no_init_weights():
            model = construct(config, dtype=resident_dtype)
    else:
        model = construct(config, dtype=resident_dtype)
    # Untied endpoint stages need only one vocabulary matrix. Empty parameters
    # are filled by the authenticated checkpoint coverage gate before forward.
    if reduced_untied:
        if spec.first:
            embedding = model.model.embed_tokens
            embedding.weight = nn.Parameter(torch.empty(
                original_vocab_size, embedding.embedding_dim, dtype=resident_dtype,
            ))
            embedding.num_embeddings = original_vocab_size
            embedding.padding_idx = original_pad_token_id
        if spec.last:
            projection = model.lm_head
            if projection.bias is not None:
                raise ValueError('untied Qwen3 vocabulary projection must be bias-free')
            projection.weight = nn.Parameter(torch.empty(
                original_vocab_size, projection.in_features, dtype=resident_dtype,
            ))
            projection.out_features = original_vocab_size
        model.config.vocab_size = original_vocab_size
        model.config.pad_token_id = original_pad_token_id
    adapter.inspect_constructed_model(model, local_layers=local_layers)
    if not spec.last:
        model.model.norm = nn.Identity()
        model.lm_head = nn.Identity()
    if not spec.first:
        # Tied final projections retain their original vocabulary parameter;
        # replacing the unused embedding releases only its duplicate module path.
        model.model.embed_tokens = nn.Embedding(
            1, model.config.hidden_size, dtype=resident_dtype,
        )
    if reduced:
        model.config.vocab_size = original_vocab_size
        model.config.pad_token_id = original_pad_token_id
    return model
