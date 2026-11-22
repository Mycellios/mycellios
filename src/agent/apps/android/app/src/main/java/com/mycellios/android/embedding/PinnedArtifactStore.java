package com.mycellios.android.embedding;

import com.mycellios.android.embedding.MemoryEmbeddingPins.PinnedFile;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Downloads and verifies the pinned phone artifact in app-private storage
 * (root/<identity>/). A file is only renamed into place after its exact size
 * and sha256 match the pin; anything else is deleted. Downloads stop between
 * 1 MiB chunks when the gate closes and resume later from the partial file.
 * Plain Java: the Android host supplies the HTTPS source and the gate.
 */
public final class PinnedArtifactStore {
  public interface Source {
    /** Bytes of the pinned file starting at offset. */
    InputStream open(PinnedFile file, long offset) throws IOException;
  }

  public interface Gate {
    boolean open();
  }

  public interface Space {
    long usableBytes(File directory);
  }

  /** Upper bound for the whole artifact; the fp16 export is about 1.21 GB. */
  public static final long MAX_ARTIFACT_BYTES = 1_400L << 20;
  /** Free space that must remain on the volume after the download. */
  public static final long RESERVE_BYTES = 2L << 30;
  /** An artifact unused for 14 days is deleted. */
  public static final long IDLE_EVICTION_MS = 14L * 24 * 60 * 60 * 1000;
  static final int CHUNK = 1 << 20;
  private static final String LAST_USED = "last-used";

  private final File root;
  private final File directory;
  private final List<PinnedFile> files;
  private final Space space;

  public PinnedArtifactStore(File root, String identity, List<PinnedFile> files, Space space) {
    if (identity == null || !identity.matches("sha256:[a-f0-9]{64}")) throw new IllegalArgumentException("artifact_identity_invalid");
    long total = 0;
    Set<String> names = new HashSet<>();
    for (PinnedFile file : files) {
      if (!names.add(file.fileName()) || file.fileName().equals(LAST_USED) || file.fileName().endsWith(".part"))
        throw new IllegalArgumentException("artifact_name_conflict");
      total += file.bytes;
    }
    if (files.isEmpty() || total > MAX_ARTIFACT_BYTES) throw new IllegalArgumentException("artifact_budget_exceeded");
    this.root = root;
    this.directory = new File(root, identity.substring("sha256:".length()));
    this.files = files;
    this.space = space;
  }

  public File directory() {
    return directory;
  }

  /**
   * Fetches every missing file. Returns false when the gate closed (partial
   * files are kept for resuming), true when every file is complete. A wrong
   * size or hash deletes the partial file and throws.
   */
  public boolean ensure(Source source, Gate gate) throws IOException {
    evictOthers();
    long missing = 0;
    for (PinnedFile file : files) {
      if (!complete(file)) missing += file.bytes - Math.min(file.bytes, part(file).length());
    }
    if (missing == 0) return true;
    if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("artifact_storage_unavailable");
    if (space.usableBytes(directory) - missing < RESERVE_BYTES) throw new IOException("artifact_storage_reserve");
    for (PinnedFile file : files) {
      if (complete(file)) continue;
      if (!gate.open() || !download(file, source, gate)) return false;
    }
    return true;
  }

  private boolean complete(PinnedFile file) {
    File target = new File(directory, file.fileName());
    return target.isFile() && target.length() == file.bytes;
  }

  private File part(PinnedFile file) {
    return new File(directory, file.fileName() + ".part");
  }

  private boolean download(PinnedFile file, Source source, Gate gate) throws IOException {
    File part = part(file);
    if (part.length() > file.bytes) delete(part);
    MessageDigest digest = sha256();
    long offset = 0;
    if (part.isFile()) {
      try (InputStream existing = new FileInputStream(part)) {
        offset = hash(existing, digest);
      }
    }
    long written = offset;
    try (InputStream in = source.open(file, offset); OutputStream out = new FileOutputStream(part, true)) {
      byte[] buffer = new byte[CHUNK];
      while (written <= file.bytes) {
        if (!gate.open()) return false;
        int read = readChunk(in, buffer);
        if (read < 0) break;
        written += read;
        // Never write past the pinned size; the check below rejects the file.
        if (written > file.bytes) break;
        out.write(buffer, 0, read);
        digest.update(buffer, 0, read);
      }
    }
    // A stream that ended early keeps its partial file for the next attempt.
    if (written < file.bytes) throw new IOException("artifact_download_incomplete");
    if (written > file.bytes) {
      delete(part);
      throw new IOException("artifact_size_mismatch");
    }
    if (!MemoryEmbeddingPins.hex(digest.digest()).equals(file.sha256)) {
      delete(part);
      throw new IOException("artifact_hash_mismatch");
    }
    if (!part.renameTo(new File(directory, file.fileName()))) throw new IOException("artifact_storage_unavailable");
    return true;
  }

  /** Fills the buffer as far as possible; -1 only at end of stream with nothing read. */
  private static int readChunk(InputStream in, byte[] buffer) throws IOException {
    int total = 0;
    while (total < buffer.length) {
      int read = in.read(buffer, total, buffer.length - total);
      if (read < 0) return total == 0 ? -1 : total;
      total += read;
    }
    return total;
  }

  /**
   * Hashes every final file against its pin before a runtime may load it.
   * Deletes any file that does not match, so the next ensure() refetches it.
   */
  public boolean verified() throws IOException {
    boolean ok = true;
    for (PinnedFile file : files) {
      File target = new File(directory, file.fileName());
      if (!target.isFile() || target.length() != file.bytes) {
        ok = false;
        continue;
      }
      MessageDigest digest = sha256();
      try (InputStream in = new FileInputStream(target)) {
        hash(in, digest);
      }
      if (!MemoryEmbeddingPins.hex(digest.digest()).equals(file.sha256)) {
        delete(target);
        ok = false;
      }
    }
    return ok;
  }

  public void markUsed(long now) throws IOException {
    if (!directory.isDirectory()) return;
    try (OutputStream out = new FileOutputStream(new File(directory, LAST_USED))) {
      out.write(Long.toString(now).getBytes(StandardCharsets.US_ASCII));
    }
  }

  /** Deletes this artifact when it has not been used for IDLE_EVICTION_MS. */
  public boolean evictIfIdle(long now) throws IOException {
    if (!directory.isDirectory()) return false;
    long lastUsed = directory.lastModified();
    File marker = new File(directory, LAST_USED);
    if (marker.isFile()) {
      try {
        lastUsed = Long.parseLong(new String(Files.readAllBytes(marker.toPath()), StandardCharsets.US_ASCII).trim());
      } catch (NumberFormatException e) {
        lastUsed = 0;
      }
    }
    if (now - lastUsed < IDLE_EVICTION_MS) return false;
    delete(directory);
    return true;
  }

  /** Removes artifacts of other identities, such as an earlier pinned revision. */
  public void evictOthers() throws IOException {
    File[] children = root.listFiles();
    if (children == null) return;
    for (File child : children) {
      if (!child.getName().equals(directory.getName())) delete(child);
    }
  }

  /** Removes every stored artifact; used when the owner opts out. */
  public void evictAll() throws IOException {
    delete(root);
  }

  private static long hash(InputStream in, MessageDigest digest) throws IOException {
    byte[] buffer = new byte[CHUNK];
    long total = 0;
    int read;
    while ((read = in.read(buffer)) >= 0) {
      digest.update(buffer, 0, read);
      total += read;
    }
    return total;
  }

  /** Deletes a file or tree without following symbolic links out of the store. */
  static void delete(File target) throws IOException {
    if (!Files.isSymbolicLink(target.toPath()) && target.isDirectory()) {
      File[] children = target.listFiles();
      if (children != null) for (File child : children) delete(child);
    }
    if (target.exists() || Files.isSymbolicLink(target.toPath())) {
      if (!target.delete()) throw new IOException("artifact_delete_failed");
    }
  }

  private static MessageDigest sha256() {
    try {
      return MessageDigest.getInstance("SHA-256");
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException(e);
    }
  }
}
