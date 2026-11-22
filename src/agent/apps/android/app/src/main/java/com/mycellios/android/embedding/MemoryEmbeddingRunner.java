package com.mycellios.android.embedding;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Runs one memory-embedding request on the phone: applies the query
 * instruction, splits the batch into bounded sub-batches, rechecks the safety
 * gate before each one and validates every vector. Request text stays in
 * memory; errors carry fixed codes only, never input or output content
 * (specs/node-owner-privacy). Plain Java for JVM tests.
 */
public final class MemoryEmbeddingRunner {
  private MemoryEmbeddingRunner() {}

  /** The on-device model. Returns one last-token hidden state per text, in order. */
  public interface Embedder {
    int countTokens(String text) throws Exception;

    float[][] embed(List<String> texts) throws Exception;
  }

  public interface Gate {
    EmbeddingSafetyGate.Reason check();
  }

  /** The gate closed between sub-batches; the request is abandoned, not partially answered. */
  public static final class StoppedException extends Exception {
    private static final long serialVersionUID = 1L;
    public final EmbeddingSafetyGate.Reason reason;

    StoppedException(EmbeddingSafetyGate.Reason reason) {
      super("memory_embedding_stopped:" + reason.name().toLowerCase(java.util.Locale.ROOT));
      this.reason = reason;
    }
  }

  /** A request or model output that breaks the contract. The message is a fixed code. */
  public static final class InvalidException extends Exception {
    private static final long serialVersionUID = 1L;
    InvalidException(String code) {
      super(code);
    }
  }

  public static final class Result {
    public final float[][] vectors;
    public final int promptTokens;

    Result(float[][] vectors, int promptTokens) {
      this.vectors = vectors;
      this.promptTokens = promptTokens;
    }
  }

  /** Padded tokens per sub-batch; small so the gate is rechecked often on a phone. */
  public static final int SUB_BATCH_TOKENS = 2048;

  /** Same limits as memoryEmbeddingInputSchema; adds the query instruction. */
  public static List<String> prepare(List<String> inputs, String inputType) throws InvalidException {
    if (inputs == null || inputs.isEmpty() || inputs.size() > MemoryEmbeddingPins.MAX_INPUTS)
      throw new InvalidException("memory_embedding_invalid_input");
    String prefix;
    if ("query".equals(inputType)) prefix = MemoryEmbeddingPins.QUERY_INSTRUCTION;
    else if (inputType == null || "document".equals(inputType)) prefix = "";
    else throw new InvalidException("memory_embedding_invalid_input_type");
    List<String> texts = new ArrayList<>(inputs.size());
    for (String text : inputs) {
      if (text == null || text.trim().isEmpty() || text.length() > MemoryEmbeddingPins.MAX_INPUT_CHARS)
        throw new InvalidException("memory_embedding_invalid_input");
      texts.add(prefix + text);
    }
    return texts;
  }

  /** Port of plan_micro_batches: shortest first, each padded group within budget. */
  public static List<List<Integer>> planSubBatches(int[] lengths, int budget) {
    Integer[] order = new Integer[lengths.length];
    for (int i = 0; i < order.length; i++) order[i] = i;
    Arrays.sort(order, (a, b) -> Integer.compare(lengths[a], lengths[b]));
    List<List<Integer>> groups = new ArrayList<>();
    List<Integer> current = new ArrayList<>();
    int longest = 0;
    for (int index : order) {
      int size = Math.max(1, lengths[index]);
      if (!current.isEmpty() && (long) Math.max(longest, size) * (current.size() + 1) > budget) {
        groups.add(current);
        current = new ArrayList<>();
        longest = 0;
      }
      current.add(index);
      longest = Math.max(longest, size);
    }
    if (!current.isEmpty()) groups.add(current);
    return groups;
  }

  public static Result run(List<String> inputs, String inputType, Embedder embedder, Gate gate)
      throws StoppedException, InvalidException {
    List<String> texts = prepare(inputs, inputType);
    int[] lengths = new int[texts.size()];
    int tokens = 0;
    try {
      for (int i = 0; i < lengths.length; i++) {
        lengths[i] = Math.min(MemoryEmbeddingPins.MAX_INPUT_TOKENS, embedder.countTokens(texts.get(i)));
        if (lengths[i] <= 0) throw new InvalidException("memory_embedding_invalid_input");
        tokens += lengths[i];
      }
    } catch (InvalidException e) {
      throw e;
    } catch (Exception e) {
      throw new InvalidException("memory_embedding_runtime_failure");
    }
    float[][] vectors = new float[texts.size()][];
    for (List<Integer> group : planSubBatches(lengths, SUB_BATCH_TOKENS)) {
      EmbeddingSafetyGate.Reason reason = gate.check();
      if (reason != EmbeddingSafetyGate.Reason.ELIGIBLE) throw new StoppedException(reason);
      List<String> batch = new ArrayList<>(group.size());
      for (int index : group) batch.add(texts.get(index));
      float[][] rows;
      try {
        rows = embedder.embed(Collections.unmodifiableList(batch));
      } catch (Exception e) {
        throw new InvalidException("memory_embedding_runtime_failure");
      }
      if (rows == null || rows.length != group.size()) throw new InvalidException("memory_embedding_count_mismatch");
      for (int i = 0; i < rows.length; i++) vectors[group.get(i)] = normalized(rows[i]);
    }
    return new Result(vectors, tokens);
  }

  /**
   * L2-normalizes a hidden state. Rejects wrong dimensions, non-finite values
   * and near-zero vectors (a faulted backend), like the replica's unit check.
   */
  static float[] normalized(float[] row) throws InvalidException {
    if (row == null || row.length != MemoryEmbeddingPins.DIMENSIONS) throw new InvalidException("memory_embedding_dimension_mismatch");
    double sum = 0;
    for (float value : row) {
      if (!Float.isFinite(value)) throw new InvalidException("memory_embedding_vector_integrity_failure");
      sum += (double) value * value;
    }
    double norm = Math.sqrt(sum);
    if (!(norm > 1e-6)) throw new InvalidException("memory_embedding_vector_integrity_failure");
    float[] out = new float[row.length];
    double check = 0;
    for (int i = 0; i < row.length; i++) {
      out[i] = (float) (row[i] / norm);
      check += (double) out[i] * out[i];
    }
    if (Math.abs(Math.sqrt(check) - 1) > MemoryEmbeddingPins.UNIT_NORM_TOLERANCE)
      throw new InvalidException("memory_embedding_vector_integrity_failure");
    return out;
  }

  /** Cosine against the pinned CPU fp32 canary reference. */
  public static double canaryCosine(float[] vector) {
    float[] reference = MemoryEmbeddingPins.canaryReference();
    if (vector == null || vector.length != reference.length) return 0;
    double dot = 0, left = 0, right = 0;
    for (int i = 0; i < reference.length; i++) {
      dot += (double) vector[i] * reference[i];
      left += (double) vector[i] * vector[i];
      right += (double) reference[i] * reference[i];
    }
    return left > 0 && right > 0 ? dot / Math.sqrt(left * right) : 0;
  }

  /**
   * On-device self-check before advertising: the canary query must reach the
   * contract's qualification threshold. This does not replace the coordinator's
   * native qualification; it only keeps a drifting runtime from advertising.
   */
  public static boolean canaryPasses(Embedder embedder, Gate gate) {
    try {
      Result result = run(Collections.singletonList(MemoryEmbeddingPins.CANARY_QUERY), "query", embedder, gate);
      return canaryCosine(result.vectors[0]) >= MemoryEmbeddingPins.CANARY_MIN_COSINE;
    } catch (StoppedException | InvalidException e) {
      return false;
    }
  }
}
