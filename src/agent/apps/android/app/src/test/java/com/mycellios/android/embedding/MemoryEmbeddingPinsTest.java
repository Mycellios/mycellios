package com.mycellios.android.embedding;

import static org.junit.Assert.*;

import com.mycellios.android.embedding.MemoryEmbeddingPins.PinnedFile;
import org.junit.Test;

public class MemoryEmbeddingPinsTest {
  @Test public void phoneIdentityIsComputedFromThePins() {
    assertEquals(MemoryEmbeddingPins.PHONE_DIGEST, MemoryEmbeddingPins.phoneDigest());
  }

  @Test public void phoneTokenizerIsThePinnedTokenizer() {
    PinnedFile tokenizer = null;
    for (PinnedFile file : MemoryEmbeddingPins.PHONE_FILES) if (file.path.equals("tokenizer.json")) tokenizer = file;
    assertNotNull(tokenizer);
    assertEquals(MemoryEmbeddingPins.PINNED_TOKENIZER_SHA256, tokenizer.sha256);
  }

  @Test public void filesComeOnlyFromThePinnedRevision() {
    for (PinnedFile file : MemoryEmbeddingPins.PHONE_FILES) {
      assertEquals("https://huggingface.co/onnx-community/Qwen3-Embedding-0.6B-ONNX/resolve/"
          + MemoryEmbeddingPins.PHONE_SOURCE_REVISION + "/" + file.path, file.url());
    }
    assertEquals("model_fp16.onnx_data", MemoryEmbeddingPins.PHONE_FILES.get(1).fileName());
  }

  @Test public void canaryReferenceIsAUnitVector() {
    float[] reference = MemoryEmbeddingPins.canaryReference();
    assertEquals(MemoryEmbeddingPins.DIMENSIONS, reference.length);
    double sum = 0;
    for (float value : reference) sum += (double) value * value;
    assertEquals(1.0, Math.sqrt(sum), 1e-4);
  }
}
