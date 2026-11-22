package com.mycellios.android.embedding;

import static org.junit.Assert.*;

import com.mycellios.android.embedding.MemoryEmbeddingPins.PinnedFile;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class PinnedArtifactStoreTest {
  @Rule public TemporaryFolder temp = new TemporaryFolder();
  private static final String IDENTITY = "sha256:" + "a".repeat(64);
  private static final PinnedArtifactStore.Space PLENTY = directory -> Long.MAX_VALUE / 2;

  private static byte[] bytes(int size, long seed) {
    byte[] value = new byte[size];
    new Random(seed).nextBytes(value);
    return value;
  }

  private static PinnedFile pin(String path, byte[] content) {
    return new PinnedFile(path, content.length, MemoryEmbeddingPins.hex(MemoryEmbeddingPins.sha256(content)));
  }

  /** Serves fixed contents and records each requested offset. */
  private static final class FakeSource implements PinnedArtifactStore.Source {
    final Map<String, byte[]> contents = new HashMap<>();
    final List<Long> offsets = new ArrayList<>();

    @Override public ByteArrayInputStream open(PinnedFile file, long offset) {
      offsets.add(offset);
      byte[] all = contents.get(file.path);
      return new ByteArrayInputStream(all, (int) offset, all.length - (int) offset);
    }
  }

  @Test public void downloadsVerifiesAndStoresFlat() throws IOException {
    byte[] graph = bytes(1000, 1), data = bytes(3 * PinnedArtifactStore.CHUNK + 17, 2);
    FakeSource source = new FakeSource();
    source.contents.put("onnx/model.onnx", graph);
    source.contents.put("onnx/model.onnx_data", data);
    PinnedArtifactStore store = new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Arrays.asList(pin("onnx/model.onnx", graph), pin("onnx/model.onnx_data", data)), PLENTY);
    assertTrue(store.ensure(source, () -> true));
    assertArrayEquals(data, Files.readAllBytes(new File(store.directory(), "model.onnx_data").toPath()));
    assertTrue(store.verified());
    // Complete files are not fetched again.
    source.offsets.clear();
    assertTrue(store.ensure(source, () -> true));
    assertTrue(source.offsets.isEmpty());
  }

  @Test public void wrongBytesAreDeletedNeverInstalled() throws IOException {
    byte[] good = bytes(5000, 3), bad = bytes(5000, 4);
    FakeSource source = new FakeSource();
    source.contents.put("tokenizer.json", bad);
    PinnedArtifactStore store = new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Collections.singletonList(pin("tokenizer.json", good)), PLENTY);
    IOException error = assertThrows(IOException.class, () -> store.ensure(source, () -> true));
    assertEquals("artifact_hash_mismatch", error.getMessage());
    assertFalse(new File(store.directory(), "tokenizer.json").exists());
    assertFalse(new File(store.directory(), "tokenizer.json.part").exists());
  }

  @Test public void oversizedDownloadIsRejected() throws IOException {
    byte[] good = bytes(5000, 5), longer = Arrays.copyOf(good, 6000);
    FakeSource source = new FakeSource();
    source.contents.put("tokenizer.json", longer);
    PinnedArtifactStore store = new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Collections.singletonList(pin("tokenizer.json", good)), PLENTY);
    assertEquals("artifact_size_mismatch", assertThrows(IOException.class, () -> store.ensure(source, () -> true)).getMessage());
    assertFalse(new File(store.directory(), "tokenizer.json.part").exists());
  }

  @Test public void truncatedStreamKeepsItsPartialFile() throws IOException {
    byte[] data = bytes(5000, 10);
    FakeSource source = new FakeSource();
    source.contents.put("weights.bin", Arrays.copyOf(data, 3000));
    PinnedArtifactStore store = new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Collections.singletonList(pin("weights.bin", data)), PLENTY);
    assertEquals("artifact_download_incomplete", assertThrows(IOException.class, () -> store.ensure(source, () -> true)).getMessage());
    assertEquals(3000, new File(store.directory(), "weights.bin.part").length());
    source.contents.put("weights.bin", data);
    assertTrue(store.ensure(source, () -> true));
    assertTrue(store.verified());
  }

  @Test public void closedGateStopsAndResumesWithTheRightHash() throws IOException {
    byte[] data = bytes(4 * PinnedArtifactStore.CHUNK + 5, 6);
    FakeSource source = new FakeSource();
    source.contents.put("weights.bin", data);
    PinnedArtifactStore store = new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Collections.singletonList(pin("weights.bin", data)), PLENTY);
    int[] checks = {0};
    assertFalse(store.ensure(source, () -> ++checks[0] <= 3));
    File part = new File(store.directory(), "weights.bin.part");
    assertTrue(part.length() > 0 && part.length() < data.length);
    long resumedAt = part.length();
    assertTrue(store.ensure(source, () -> true));
    assertEquals(Long.valueOf(resumedAt), source.offsets.get(source.offsets.size() - 1));
    assertTrue(store.verified());
  }

  @Test public void refusesToFillTheStorageReserve() {
    byte[] data = bytes(2048, 7);
    PinnedArtifactStore store = new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Collections.singletonList(pin("weights.bin", data)), directory -> PinnedArtifactStore.RESERVE_BYTES + 1000);
    FakeSource source = new FakeSource();
    source.contents.put("weights.bin", data);
    assertEquals("artifact_storage_reserve", assertThrows(IOException.class, () -> store.ensure(source, () -> true)).getMessage());
    assertTrue(source.offsets.isEmpty());
  }

  @Test public void tamperedFileFailsVerificationAndIsRemoved() throws IOException {
    byte[] data = bytes(4096, 8);
    FakeSource source = new FakeSource();
    source.contents.put("weights.bin", data);
    PinnedArtifactStore store = new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Collections.singletonList(pin("weights.bin", data)), PLENTY);
    assertTrue(store.ensure(source, () -> true));
    byte[] changed = data.clone();
    changed[100] ^= 1;
    File target = new File(store.directory(), "weights.bin");
    Files.write(target.toPath(), changed);
    assertFalse(store.verified());
    assertFalse(target.exists());
  }

  @Test public void evictsOtherIdentitiesIdleArtifactsAndOptOut() throws IOException {
    byte[] data = bytes(1024, 9);
    FakeSource source = new FakeSource();
    source.contents.put("weights.bin", data);
    File old = new File(temp.getRoot(), "b".repeat(64));
    assertTrue(old.mkdirs());
    Files.write(new File(old, "weights.bin").toPath(), data);
    PinnedArtifactStore store = new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Collections.singletonList(pin("weights.bin", data)), PLENTY);
    assertTrue(store.ensure(source, () -> true));
    assertFalse(old.exists());
    store.markUsed(1_000);
    assertFalse(store.evictIfIdle(1_000 + PinnedArtifactStore.IDLE_EVICTION_MS - 1));
    assertTrue(store.evictIfIdle(1_000 + PinnedArtifactStore.IDLE_EVICTION_MS));
    assertFalse(store.directory().exists());
    assertTrue(store.ensure(source, () -> true));
    store.evictAll();
    assertFalse(temp.getRoot().exists());
  }

  @Test public void rejectsUnsafePinsAndBudgets() {
    assertThrows(IllegalArgumentException.class, () -> new PinnedFile("../escape", 1, "a".repeat(64)));
    assertThrows(IllegalArgumentException.class, () -> new PinnedFile("/abs", 1, "a".repeat(64)));
    assertThrows(IllegalArgumentException.class, () -> new PinnedFile("ok", 1, "not-a-hash"));
    assertThrows(IllegalArgumentException.class, () -> new PinnedArtifactStore(temp.getRoot(), "bad",
        Collections.singletonList(new PinnedFile("a", 1, "a".repeat(64))), PLENTY));
    assertThrows(IllegalArgumentException.class, () -> new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Arrays.asList(new PinnedFile("x/a", 1, "a".repeat(64)), new PinnedFile("y/a", 1, "b".repeat(64))), PLENTY));
    assertThrows(IllegalArgumentException.class, () -> new PinnedArtifactStore(temp.getRoot(), IDENTITY,
        Collections.singletonList(new PinnedFile("big", PinnedArtifactStore.MAX_ARTIFACT_BYTES + 1, "a".repeat(64))), PLENTY));
  }

  @Test public void phoneArtifactFitsTheBudget() {
    new PinnedArtifactStore(temp.getRoot(), MemoryEmbeddingPins.phoneDigest(), MemoryEmbeddingPins.PHONE_FILES, PLENTY);
  }
}
