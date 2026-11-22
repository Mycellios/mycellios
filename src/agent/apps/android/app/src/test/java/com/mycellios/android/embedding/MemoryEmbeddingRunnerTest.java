package com.mycellios.android.embedding;

import static org.junit.Assert.*;

import com.mycellios.android.embedding.EmbeddingSafetyGate.Reason;
import com.mycellios.android.embedding.MemoryEmbeddingRunner.InvalidException;
import com.mycellios.android.embedding.MemoryEmbeddingRunner.StoppedException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.function.Function;
import org.junit.Test;

public class MemoryEmbeddingRunnerTest {
  private static final String SECRET = "private note: the door code is 4417";

  /** Counts tokens as characters/4 and returns a fixed raw vector per text. */
  private static final class FakeEmbedder implements MemoryEmbeddingRunner.Embedder {
    final List<List<String>> calls = new ArrayList<>();
    final Function<String, float[]> rows;

    FakeEmbedder(Function<String, float[]> rows) {
      this.rows = rows;
    }

    @Override public int countTokens(String text) {
      return Math.max(1, text.length() / 4);
    }

    @Override public float[][] embed(List<String> texts) {
      calls.add(new ArrayList<>(texts));
      float[][] out = new float[texts.size()][];
      for (int i = 0; i < out.length; i++) out[i] = rows.apply(texts.get(i));
      return out;
    }
  }

  private static float[] axis(int index, float scale) {
    float[] value = new float[MemoryEmbeddingPins.DIMENSIONS];
    value[index] = scale;
    return value;
  }

  private static final MemoryEmbeddingRunner.Gate OPEN = () -> Reason.ELIGIBLE;

  @Test public void appliesTheQueryInstructionOnlyToQueries() throws Exception {
    assertEquals(Collections.singletonList(MemoryEmbeddingPins.QUERY_INSTRUCTION + "hola"),
        MemoryEmbeddingRunner.prepare(Collections.singletonList("hola"), "query"));
    assertEquals(Collections.singletonList("hola"), MemoryEmbeddingRunner.prepare(Collections.singletonList("hola"), "document"));
    assertEquals(Collections.singletonList("hola"), MemoryEmbeddingRunner.prepare(Collections.singletonList("hola"), null));
  }

  @Test public void rejectsRequestsOutsideTheContract() {
    List<String> tooMany = Collections.nCopies(MemoryEmbeddingPins.MAX_INPUTS + 1, "x");
    for (List<String> inputs : Arrays.asList(Collections.<String>emptyList(), tooMany, Collections.singletonList("  "),
        Collections.singletonList("x".repeat(MemoryEmbeddingPins.MAX_INPUT_CHARS + 1)))) {
      assertThrows(InvalidException.class, () -> MemoryEmbeddingRunner.prepare(inputs, "document"));
    }
    assertThrows(InvalidException.class, () -> MemoryEmbeddingRunner.prepare(Collections.singletonList("x"), "passage"));
  }

  @Test public void plansSubBatchesLikeTheReplica() {
    // Same rule as plan_micro_batches in qwen06_embedding_service.py, including its long-text case.
    assertEquals(Arrays.asList(Collections.singletonList(1), Collections.singletonList(0)),
        MemoryEmbeddingRunner.planSubBatches(new int[] {20_000, 10}, 16_384));
    assertEquals(Arrays.asList(Arrays.asList(1, 0), Collections.singletonList(2)),
        MemoryEmbeddingRunner.planSubBatches(new int[] {10, 5, 30}, 40));
    assertEquals(Collections.singletonList(Collections.singletonList(0)),
        MemoryEmbeddingRunner.planSubBatches(new int[] {500}, 100));
    assertEquals(Collections.singletonList(Arrays.asList(0, 1)), MemoryEmbeddingRunner.planSubBatches(new int[] {0, 0}, 4));
  }

  @Test public void returnsUnitVectorsInRequestOrder() throws Exception {
    FakeEmbedder embedder = new FakeEmbedder(text -> axis(text.length() % MemoryEmbeddingPins.DIMENSIONS, 7f));
    MemoryEmbeddingRunner.Result result = MemoryEmbeddingRunner.run(Arrays.asList("ccc", "a", "bb"), "document", embedder, OPEN);
    assertEquals(1f, result.vectors[0][3], 1e-6);
    assertEquals(1f, result.vectors[1][1], 1e-6);
    assertEquals(1f, result.vectors[2][2], 1e-6);
    assertEquals(3, result.promptTokens);
  }

  @Test public void stopsBetweenSubBatchesWhenTheGateCloses() {
    FakeEmbedder embedder = new FakeEmbedder(text -> axis(0, 1f));
    String longText = "y".repeat(4 * MemoryEmbeddingRunner.SUB_BATCH_TOKENS);
    int[] checks = {0};
    MemoryEmbeddingRunner.Gate gate = () -> ++checks[0] == 1 ? Reason.ELIGIBLE : Reason.NOT_CHARGING;
    StoppedException stopped = assertThrows(StoppedException.class,
        () -> MemoryEmbeddingRunner.run(Arrays.asList("short", longText), "document", embedder, gate));
    assertEquals(Reason.NOT_CHARGING, stopped.reason);
    assertEquals(1, embedder.calls.size());
    assertEquals(2, checks[0]);
  }

  @Test public void rejectsBrokenModelOutput() {
    float[] nan = axis(0, 1f);
    nan[5] = Float.NaN;
    for (float[] bad : new float[][] {new float[MemoryEmbeddingPins.DIMENSIONS], new float[512], nan}) {
      FakeEmbedder embedder = new FakeEmbedder(text -> bad);
      assertThrows(InvalidException.class, () -> MemoryEmbeddingRunner.run(Collections.singletonList("x"), "document", embedder, OPEN));
    }
    MemoryEmbeddingRunner.Embedder missingRow = new MemoryEmbeddingRunner.Embedder() {
      @Override public int countTokens(String text) { return 1; }
      @Override public float[][] embed(List<String> texts) { return new float[0][]; }
    };
    assertThrows(InvalidException.class, () -> MemoryEmbeddingRunner.run(Collections.singletonList("x"), "document", missingRow, OPEN));
  }

  @Test public void errorsNeverCarryRequestText() {
    MemoryEmbeddingRunner.Embedder failing = new MemoryEmbeddingRunner.Embedder() {
      @Override public int countTokens(String text) { return 3; }
      @Override public float[][] embed(List<String> texts) { throw new IllegalStateException(texts.get(0)); }
    };
    InvalidException error = assertThrows(InvalidException.class,
        () -> MemoryEmbeddingRunner.run(Collections.singletonList(SECRET), "query", failing, OPEN));
    assertEquals("memory_embedding_runtime_failure", error.getMessage());
    assertNull(error.getCause());
  }

  @Test public void canaryAcceptsTheReferenceAndRejectsDrift() {
    float[] reference = MemoryEmbeddingPins.canaryReference();
    FakeEmbedder exact = new FakeEmbedder(text -> {
      assertEquals(MemoryEmbeddingPins.QUERY_INSTRUCTION + MemoryEmbeddingPins.CANARY_QUERY, text);
      return reference;
    });
    assertTrue(MemoryEmbeddingRunner.canaryPasses(exact, OPEN));
    // Mix in an orthogonal-ish direction until cosine drops to about 0.99.
    float[] drifted = reference.clone();
    for (int i = 0; i < drifted.length; i += 2) drifted[i] += 0.0045f * (i % 4 == 0 ? 1 : -1);
    double cosine = MemoryEmbeddingRunner.canaryCosine(drifted);
    assertTrue(cosine < MemoryEmbeddingPins.CANARY_MIN_COSINE);
    assertFalse(MemoryEmbeddingRunner.canaryPasses(new FakeEmbedder(text -> drifted), OPEN));
    assertFalse(MemoryEmbeddingRunner.canaryPasses(new FakeEmbedder(text -> reference), () -> Reason.BATTERY_HOT));
  }
}
