package com.mycellios.android.embedding;

import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.PowerManager;
import com.mycellios.android.embedding.MemoryEmbeddingPins.PinnedFile;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;

/**
 * Android glue for phone memory embeddings: reads charging, battery
 * temperature, thermal, power-save and network state, keeps the owner's
 * opt-in (off by default) and fetches pinned files over HTTPS into
 * no-backup app storage. Nothing here starts work: no phone execution is
 * admitted yet (MemoryEmbeddingPins.PHONE_EXECUTION_ADMITTED).
 */
public final class AndroidMemoryEmbedding {
  private AndroidMemoryEmbedding() {}

  private static final String PREFERENCES = "memory-embedding";
  private static final String OPTED_IN = "optedIn";

  public static boolean optedIn(Context context) {
    return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).getBoolean(OPTED_IN, false);
  }

  /** Opting out also deletes the downloaded artifact. */
  public static void setOptedIn(Context context, boolean value) throws IOException {
    SharedPreferences.Editor editor = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit();
    editor.putBoolean(OPTED_IN, value);
    if (!editor.commit()) throw new IOException("memory_embedding_preference_unsaved");
    if (!value) store(context).evictAll();
  }

  public static PinnedArtifactStore store(Context context) {
    return new PinnedArtifactStore(new File(context.getNoBackupFilesDir(), "memory-embedding"),
        MemoryEmbeddingPins.phoneDigest(), MemoryEmbeddingPins.PHONE_FILES, File::getUsableSpace);
  }

  public static EmbeddingSafetyGate.Conditions conditions(Context context) {
    Intent battery = Build.VERSION.SDK_INT >= 33
        ? context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED), Context.RECEIVER_NOT_EXPORTED)
        : context.registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
    boolean charging = false;
    int percent = EmbeddingSafetyGate.UNKNOWN, temperature = EmbeddingSafetyGate.UNKNOWN;
    if (battery != null) {
      int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
      charging = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
          && (status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL);
      int level = battery.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = battery.getIntExtra(BatteryManager.EXTRA_SCALE, -1);
      if (level >= 0 && scale > 0) percent = level * 100 / scale;
      if (battery.hasExtra(BatteryManager.EXTRA_TEMPERATURE)) temperature = battery.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0);
    }
    PowerManager power = context.getSystemService(PowerManager.class);
    boolean powerSave = power == null || power.isPowerSaveMode();
    int thermal = power != null && Build.VERSION.SDK_INT >= 29 ? power.getCurrentThermalStatus() : EmbeddingSafetyGate.UNKNOWN;
    boolean network = false, unmetered = false;
    ConnectivityManager connectivity = context.getSystemService(ConnectivityManager.class);
    Network active = connectivity == null ? null : connectivity.getActiveNetwork();
    NetworkCapabilities capabilities = active == null ? null : connectivity.getNetworkCapabilities(active);
    if (capabilities != null) {
      network = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
          && capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
      unmetered = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
          && !connectivity.isActiveNetworkMetered();
    }
    return new EmbeddingSafetyGate.Conditions(charging, percent, temperature, thermal, powerSave, network, unmetered);
  }

  /** Fetches a pinned file from its pinned revision URL; the store checks size and hash. */
  public static final PinnedArtifactStore.Source HTTPS_SOURCE = (PinnedFile file, long offset) -> {
    HttpURLConnection connection = (HttpURLConnection) new URL(file.url()).openConnection();
    connection.setConnectTimeout(15_000);
    connection.setReadTimeout(30_000);
    connection.setInstanceFollowRedirects(true);
    connection.setRequestProperty("Accept-Encoding", "identity");
    if (offset > 0) connection.setRequestProperty("Range", "bytes=" + offset + "-");
    int code = connection.getResponseCode();
    if (!(connection instanceof HttpsURLConnection) || !"https".equals(connection.getURL().getProtocol())
        || (code != 200 && code != 206)) {
      connection.disconnect();
      throw new IOException("artifact_download_failed");
    }
    InputStream in = connection.getInputStream();
    // A server that ignores Range restarts at byte 0: skip to the resume point.
    if (offset > 0 && code == 200) {
      long skipped = 0;
      while (skipped < offset) {
        long step = in.skip(offset - skipped);
        if (step <= 0) {
          in.close();
          throw new IOException("artifact_download_failed");
        }
        skipped += step;
      }
    }
    return in;
  };
}
