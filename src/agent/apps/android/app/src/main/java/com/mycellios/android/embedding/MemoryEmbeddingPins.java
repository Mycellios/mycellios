package com.mycellios.android.embedding;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.Collections;
import java.util.List;

/**
 * Phone-side mirror of src/contracts/memory-embedding.ts. The repository test
 * tests/memory-embedding-phone.test.ts reads this file and fails when a value
 * here drifts from the contract. Plain Java, so JVM tests can check it.
 */
public final class MemoryEmbeddingPins {
  private MemoryEmbeddingPins() {}

  public static final String MODEL = "mycellios-qwen3-embedding-0.6b";
  public static final String UPSTREAM_MODEL = "Qwen/Qwen3-Embedding-0.6B";
  public static final String REVISION = "97b0c614be4d77ee51c0cef4e5f07c00f9eb65b3";
  public static final int DIMENSIONS = 1024;
  public static final int MAX_INPUTS = 64;
  public static final int MAX_INPUT_CHARS = 32_768;
  public static final int MAX_INPUT_TOKENS = 8192;
  /** Same tolerance as verifiedMemoryEmbeddingEnvelope in the contract. */
  public static final double UNIT_NORM_TOLERANCE = 0.002;
  public static final double CANARY_MIN_COSINE = 0.9995;
  public static final String CANARY_QUERY = "What is the capital of Spain?";
  /** Applied by the runtime, never by clients (qwen06_embedding_service.py). */
  public static final String QUERY_INSTRUCTION =
      "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ";
  /** sha256 of tokenizer.json at REVISION, from MEMORY_EMBEDDING_FILES. */
  public static final String PINNED_TOKENIZER_SHA256 = "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a";

  public static final String PHONE_RUNTIME = "mycellios-memory-embedding-phone/1";
  public static final String PHONE_SOURCE_REPOSITORY = "onnx-community/Qwen3-Embedding-0.6B-ONNX";
  public static final String PHONE_SOURCE_REVISION = "c25a394dd583836952667c12f008335071b3f43d";
  public static final List<PinnedFile> PHONE_FILES = Collections.unmodifiableList(Arrays.asList(
      new PinnedFile("onnx/model_fp16.onnx", 583_522L, "f376cf065d912675dd559270e19361367ebc28c938b9811dd61d5834c78d0834"),
      new PinnedFile("onnx/model_fp16.onnx_data", 1_199_927_296L, "06fbfded30166e3a33fe5252d7002ed1c370a4ec1bf45aba778cdf6cf7d31439"),
      new PinnedFile("tokenizer.json", 11_423_705L, "def76fb086971c7867b829c23a26261e38d9d74e02139253b38aeb9df8b4b50a")));
  /** MEMORY_EMBEDDING_PHONE_DIGEST; phoneDigest() recomputes it from PHONE_FILES. */
  public static final String PHONE_DIGEST = "sha256:d1a0040a2daa068f5164c307b420d34e56b12b015c95bd4a3a4af1df574a6750";
  /**
   * MEMORY_EMBEDDING_PHONE_EXECUTIONS is empty: no phone backend/precision pair
   * has been measured on a physical phone, so the host never advertises.
   */
  public static final boolean PHONE_EXECUTION_ADMITTED = false;

  /** A file of the phone artifact, fetched only at the pinned source revision. */
  public static final class PinnedFile {
    public final String path;
    public final long bytes;
    public final String sha256;

    public PinnedFile(String path, long bytes, String sha256) {
      if (path == null || !path.matches("[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*") || path.contains(".."))
        throw new IllegalArgumentException("artifact_path_invalid");
      if (bytes <= 0 || sha256 == null || !sha256.matches("[a-f0-9]{64}"))
        throw new IllegalArgumentException("artifact_pin_invalid");
      this.path = path;
      this.bytes = bytes;
      this.sha256 = sha256;
    }

    /** ONNX Runtime looks for external data beside the graph, so files are stored flat. */
    public String fileName() {
      return path.substring(path.lastIndexOf('/') + 1);
    }

    public String url() {
      return "https://huggingface.co/" + PHONE_SOURCE_REPOSITORY + "/resolve/" + PHONE_SOURCE_REVISION + "/" + path;
    }
  }

  /** Same construction as MEMORY_EMBEDDING_PHONE_DIGEST. */
  public static String phoneDigest() {
    List<String> parts = new ArrayList<>();
    parts.add(PHONE_RUNTIME);
    parts.add(PHONE_SOURCE_REVISION);
    List<PinnedFile> sorted = new ArrayList<>(PHONE_FILES);
    Collections.sort(sorted, (a, b) -> a.path.compareTo(b.path));
    for (PinnedFile file : sorted) parts.add(file.path + ":" + file.sha256);
    return "sha256:" + hex(sha256(String.join("\0", parts).getBytes(StandardCharsets.UTF_8)));
  }

  static byte[] sha256(byte[] value) {
    try {
      return MessageDigest.getInstance("SHA-256").digest(value);
    } catch (java.security.NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }

  static String hex(byte[] value) {
    StringBuilder out = new StringBuilder(value.length * 2);
    for (byte b : value) out.append(Character.forDigit((b >> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
    return out.toString();
  }

  /**
   * CPU fp32 reference for QUERY_INSTRUCTION + CANARY_QUERY at REVISION
   * (little-endian float32, base64); the contract's CANARY_REFERENCE_BASE64.
   */
  static final String CANARY_REFERENCE_BASE64 =
      "JyviPN0zMz3/gNU67m7JvEBUyT3JEqC9UkCxPKBn5LxqcYa7rnPZvBtimj1ROZK88qD6PGmHTLq2oxC9/30HPe/FDL1AT2I9"
      + "QXgEPMFXTTwxHpM9yzPDPJl9lj2V+QS8UYHIPbY3OT243LC9kbzPu9AgGDzTtJA8cNmoPZ1SX7uwQJo8vB4qPQ8qXjxT0zK7"
      + "CK8dPeaw37tBHga8riCcPH8+lzyTTpu8EtJ8vSWVsTxe4/88BSqwvOUjrLz9pUo8eOKkvLbyIL3UYE+8oy+jPFJlxjw4CRK7"
      + "I7J4vE2XeTwdFMo8MGE1PdFY6Twfvhi8ie3JO5wgSDwprbA8lT+LPHITYbsa7Cc9TgA3veVe7LwLn448wBMqPRjZ7Lx2e5i7"
      + "h6PBPLllSjupcdK86Vd0PbMHRT1FslO9QqnhPDHNgL2DbYE6MO0aPTAthju68kU9nixbu2amT7uQhGw8RxrVvP1KFD2t9wc7"
      + "BnwIPTyGFT0UBQy9bYF3PY1YB73OQaG8h6UVPUJZnj0HLdi86egyPV+saLzgc1295529PI6WCz3eylC9TGhOOn8dYb2WQiE9"
      + "w4hRvGD+D7wLpOk74ubyu5iWF71rRAG9r+7hvLx/mzz/A/W7Lm5OvQV4njyS0AC9eYJWPZBeEj0Dvx+9SilhvLVak701GwS7"
      + "qgcLvEiJJDz2OLy753+3vO4aI71MDuC7IaS5PCD+4ryLLig9i5BMO0RiLDsojwG8krIbPFXW5jyTvQg95wFmu6NjeLxMyuu8"
      + "nybuulkMnzw3iJM7aMzKPBPRT7xcFro8iACGvL+cRD1JWVY83B0tPHFd0TzEp4m8HcJWvXBynLyH3zC6pZpWPGb9kDyQwwW8"
      + "OqgKvStPu7yLPaS8L6kUPfmGXT1C7pM7KeWouLIBCD38PWY8ySy7PEJfKTz8Hwu8bT6cuht1aLwEaDE8nOI+vT+5Rr0ucj28"
      + "bKFLPJqz9Tys8jY9/Hq1PKOh7Dx866Y92eLePLLJFr16nyE85UN0veiL6juetKM8ZgD3u31aRruN1+g77sLgvAdJAjyCTN+6"
      + "YzfwO2lmiTreHZU7f1bKu8h7B72L8w08Y4KHvGlvEzs4j2g8Hc2pPCFLkrwo/a67jBW7O6qCLjs2h8Q8uVNfvPzNrLxsV407"
      + "PWA9vbqKZj25R6a86Ac6PV0o6LffiZy7VVr/vO8edTwxQhm9VnYWvXihrjq98qA8c/HOPJMf2rvNm4u9+U0ZvCaLIb1kdAS9"
      + "r2XcPBSyGL3bx5K7NlaCPapDxDxdiU+9Z3UrPRpakDwhDYw8CS/OuqLCgL2AQg09zaNsvTgGTry/raS7YgMPPVWNGD1nCJM8"
      + "bcYQOjcD+Ls1aKo87LapPM2/ILzKC3W8i2Ntu5MlsDvGYhO9GoOTvNp32bxZB5o8hufBu1oQpDy2wBq9QWjxvPCCFDz3d7O8"
      + "qCd7O62Iojxwgq66t9ZRvD/A27xMyyq9wB/9u1jRC730y4c6aAuiPbsgLz0YHRC8ROYFvWRVFz2krp48tZqkPERNoDy7wVG8"
      + "U0EiPT2jmDzUESE97aCzO3y77rskS3M7hHBLu2SOwbs/xwW7QOmWPfMvIT2kVQo9oRUjPLrYTb1ShO68CSdXPfKgEb1M48G8"
      + "cBWVPePUi72ucru8clpXvJIsoDzemyg9pYFTvA0Bjby2R388XwkXPc3HQLuZG0Y93+eMPDgXqr2oHNu88nh+PKE+BbwrGBi7"
      + "hFEYPaGfbjzMQQS9aOgcPYQIXz271UA9NJsCvKXrRryEbeY7SoFBPTlaFL0dqle8wGrnPILuaruCXR29onk2Os/zW7xZnli8"
      + "HY4EvVr5nDypXw88gPZ1vYdthTxYuLg6u7uOvGV2AT0YVDY9LA6YPPv2Tj0ewQA9A5S3vNGHbb2tVIu8gwf6PNF6QTyfCJY8"
      + "Qk8gvZtiEryeykk9elCKPJZUET01PXs9g90TvGcg8rxeGzc8En8Hvea8BL45Z4K8pHfYPGljkTr2FNM8CDGBvWfRsLwUEta8"
      + "6cfUvJAJOrncjku99I6xvPfRgrwqtVS8LQIbvRsrhzutHo28ULCrPKpCcLtyMAA90oDBPKcPn73mnpI9BMryvH9BJT2O9F+7"
      + "A9TIPCoqPTzv31C8oDbWvI1iMT1OSZY7v2mzvH+j4DwZmSI9eu5UPODXdLzcrLQ73qLqO5zleDzGRP08ICTcvJ0HAT1Ocwu9"
      + "s5jGvP4TAz1BqgK9irbGO3FlET0f4R09LPO+PC4kgD1H4TK8G4MxPMQDtbwUclC7yy6kvAcDcrygGBM8NfaWPac8QryRVAO9"
      + "82T/OwxVPT0NwRY813fkvCCciDyBW4K82QDCPPOZhTytbJE8NNF6PYOPAj3/PmC9ehnZvFiUKT1W1/e8VoR9vLu8sj0nJWU7"
      + "u1VaPO85Rb1J7q+8GmBOPakV8DzNgVw8cH8BPZrs4Ly9/Qa8W/JJPfNlYryf06u87tEMvDaRP71reUC995WgOzshqr1k9EM8"
      + "2+4JOeh5eLx0Dwc8lTgGPe2J5zrX/p08udRmvNmrhzy1MJI8ONouPR/EFDxIsQY9iHnlvOF64ry5SdO7iMtMPLFH6zxaVyO8"
      + "4pbxO8L+kzzQ2zm8YwBevVTlTb2nrAi805vDvJpyK7vuF928zM57PMLZ07x5yZO9pOUmvKPDo7vaiW89lZciPZq1hr3X9O68"
      + "fyZpPT65F73uTrg7dw6ru4IRAz0htNU8D3ZTPbNu37w27yC9397Vu4CHAbwba1y8pR4FPDjmKT2+lUC995WkvHFcgL041Oo8"
      + "fYlUPVVQkrt3qAA7mWBcPLNprzwFCQ28BIkbPON1LzyuWOQ88zjXu2nqAT2we1299R6APegNzbxI1k09X4B4vPN/mDpZ8bI8"
      + "eBiuPBLZxLwieD+9wPsWPdHmJrxSw069SM33Oza2+rzcfB28Ia6EPA4BRrvs2Ne8RzXpvIXPcr3bKwW9j/LfPE7BmDtNwmY9"
      + "M7EvPaTpqbzTiYA8hwMGPUB4d7x4m3e89ODgPN8q5btqqoq8vNZdvMNgPzwQ9So9DoEdPEI8+Lylhq08NVs5PVDdBbxZYm69"
      + "2OdSu6KSVT0bGo689xK4PKP/j7xbYQk9rjqAPIEHHDzT4JK9/OkAPcMytzvBKZk830ElPS/uAz1Fn0y86k7YubhYLbzUnJY8"
      + "1nnNvOU0LT3H5j69/uNFPOAOrro2UDq9Yi/ROzpCqrxbQPi8DgVUPCGEhLwFqQm91NNoumTx7ryKvIK8cWbnvM8qv7w9nj88"
      + "ZmW4vIvQVb2pKje7N3qsvGUqiLwmGCk9ljQivbYS0bwSQ+88AAiHu5uFnLwBFmG8cNnOvAb8D7s8MY27DZNQvc9OvLv1GNE8"
      + "n3VEPHy8ODzrXgU7cWhEvN9nlrzYMuu8nFgdvDH4ljxVSZm9gT8MvG+HOryG7Qw8zxGsuodSF71bzuq8ffiKO/f6wzwE1aI7"
      + "IN3SPEnF8rtgd8k7L2OGPAo7NT1JwNO83hI0vLh0sr2rCcC8wYThvFvpTz2njAO7tmJ/O4b3ab35eHM88fdbvVbPF7zveq69"
      + "C+CBvEme0TwLJpq8yX9RPTYpEL0Droi8elMFPQfA3jk2sQA9z+x2u2jOJrydSgK9IWyJPBSq6TwqoIa7bJBuPFpy5Ty1Ynu8"
      + "2OjpPAB6Lb1TeeS8fsfQvCCnrT2YXJa8ZcbtvMm+X7yByW08VZGEPBeT8DsnU6U6aqFmvJMbVzyDYw69hKfLu0qRiztD5Ca8"
      + "2DuQvefCEL2jnv86ad+EO7jsHb1ntiO8eXPuvLdlwrvkUTO5mYmSu8hptTxNvlm9LUx3PUPgfrzPou67ZmBMPOrwLj1AehU8"
      + "g6kVueN4OLvkeqY8Krq2uhAJlDyLxmy9Bh17u94uKzxoSBY9W9L3vDDTpjwT/o+9pUM1PaD3grwjUX27O9y8vM5EjTw2gUM8"
      + "Aw/vPN6u3TxF/kC9eLYRPYDQh7spMcc8r+CoPCLhoLzCghm8l1hPPImoEb3c6pg8nwhDO0G6Gjx1hce8gqhdPUeaHTytiJS7"
      + "ykCHvZT6CzquaqA9XnUDPGZvKzyx9Tm8bgSzO84fJj3clCc7GvbduRNpUL0b+MS82Vm7vDAq5Ln90Ak8zFAEvEgWpzymGbs7"
      + "NOcuPLnxKT1rLTo8cxsFvUodjTsMRW+8zxwVvRA4g70I9d28yyAcPT9JML1TUjs8ISYmvaorar1Mou68i6NLPRHPZLwh7No7"
      + "1linvBdqozxENfM8BaPwubRqGDwaGJ27w4bGvEpGSLyDC6w9OId7PKEUib0RpiM8EoAiPZ5nOL2KOF29XskMvBVZPb0cYIU8"
      + "7273PNlCFLztukW8IUuCvHiRfjqpLiA9Mw2xPIHl9bybP8C8Y08avJ5ZTzzTeb68BJyMPNuqgzqxHCc95+v4PGnCUTyez+o7"
      + "XA6JvFtCyDynSx286cZzvZONRT3n1uW7IdCGOxdQ97sWHzW86XxhPQBnBzxUVfO8wxiHPT1RxTuZ2T89Xhmbu2VU5jzsHpW7"
      + "imymvPO0g7zEbwM9d53dPIyZ/TsDfTI8oEPyO9mhXz2GHXC9nGcJut0JAL3iCfG8yy1dvJmTMb2Fy4m8aDLdvMvRLbzflSq9"
      + "TenUu6jjj7ybvZO8jFqRvLDU9DxcoWy8b3BfPPkPkzysYjg7tNEFvfpUbDvQ2QQ8hePHvDophLxr60Y9YiagPLjeZ7xS4gK8"
      + "Qf5cvGEdozxcVDK8OlasO248GD1sLRC9GCeIO3i+hb2CEmg99KftvK+S7Lo+osC8S5eLvcZn+bwvyTQ8u1Oduy/IFb2kNqq8"
      + "dyCOPKg9dDzjVyu9vBGBvLO1+7yJcik8ejzFu2FqubxEdty8gOmBPLLlRr2+Nqm78zr5PHsP9DyHr4q7mNzgvJUjvTx3XxM9"
      + "X+SVPKEN+7tqGmM9cPP7vLe+DD2E9TQ9p9iMPCBeUz1c6mS88pnpPLg9Pjz+xN08zpiHuyt2CT1F5wa86i5+Pf1R6bxISz08"
      + "FFWIPNwqIb3ZyxW7t3b+vPOFVL1iq4S8IxvVPDfuGT0dwwU9vbPOvOmEEb2XHYS8vNWcvGsbmLwzkL+7FMfDPC5+JL2/G3G8"
      + "wMqPvKfgSr1Zy3u8w8yAvPcnz7yBy+I8qR38POyYGTyhfWU8sCURva+OmjpZOxs8XZ9OvenpiTxtI0i7/airPUm4qLzXvAy8"
      + "vqCPPesDEr0Aku48UgO5OwKtL73dWJM8FsIKvIwOk7vdpv87YDqKvQ4LR7zEerc7tNOePBIerroBh3Q8ArAIPRIlfzv6g868"
      + "CO3hPGbZhr3bwEG8w2nru+J/eDueDJo8aKkUPS9m9LuCvn09Ny+DvPVrjj3etjO9H5P0O+DuvDzOFIy89A/yPF9d2zqmp4c7"
      + "goTQvOz2Oj3OpnQ92ZcevBy5D70FuYu8oCBCvaFnY7y+RhE8GE6pvA7sDj3woKu8eyGpvDR/JD341TQ98Zj6vA==";

  private static float[] canaryReference;

  static synchronized float[] canaryReference() {
    if (canaryReference == null) {
      byte[] bytes = Base64.getDecoder().decode(CANARY_REFERENCE_BASE64);
      if (bytes.length != DIMENSIONS * 4) throw new IllegalStateException("canary_reference_invalid");
      ByteBuffer buffer = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
      float[] values = new float[DIMENSIONS];
      for (int i = 0; i < DIMENSIONS; i++) values[i] = buffer.getFloat();
      canaryReference = values;
    }
    return canaryReference.clone();
  }
}
