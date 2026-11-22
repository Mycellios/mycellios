package com.mycellios.android.embedding;

/**
 * Decides whether this phone may serve memory embeddings right now. Every
 * condition fails closed: an unknown battery temperature or network state is
 * treated as unsafe. Battery temperature uses hysteresis so a phone near the
 * limit does not flap between serving and pausing. Plain Java for JVM tests.
 */
public final class EmbeddingSafetyGate {
  public enum Reason {
    ELIGIBLE, NOT_OPTED_IN, EXECUTION_NOT_ADMITTED, NOT_CHARGING, BATTERY_LOW,
    BATTERY_TEMPERATURE_UNKNOWN, BATTERY_HOT, DEVICE_HOT, POWER_SAVE, NO_NETWORK, METERED_NETWORK
  }

  /** Start only below 36.0 °C; stop at 38.0 °C. Android reports tenths of a degree. */
  public static final int START_BELOW_TENTHS_C = 360;
  public static final int STOP_AT_TENTHS_C = 380;
  /** Charging from a weak source can still drain the battery under load. */
  public static final int MIN_BATTERY_PERCENT = 50;
  /** PowerManager.THERMAL_STATUS_LIGHT; MODERATE and above pause work. */
  public static final int MAX_THERMAL_STATUS = 1;
  public static final int UNKNOWN = Integer.MIN_VALUE;

  /** One snapshot of the phone's state. Use UNKNOWN for values Android did not report. */
  public static final class Conditions {
    public final boolean charging;
    public final int batteryPercent;
    public final int batteryTenthsCelsius;
    /** PowerManager thermal status; UNKNOWN before Android 10. */
    public final int thermalStatus;
    public final boolean powerSave;
    public final boolean network;
    public final boolean unmetered;

    public Conditions(boolean charging, int batteryPercent, int batteryTenthsCelsius, int thermalStatus,
        boolean powerSave, boolean network, boolean unmetered) {
      this.charging = charging;
      this.batteryPercent = batteryPercent;
      this.batteryTenthsCelsius = batteryTenthsCelsius;
      this.thermalStatus = thermalStatus;
      this.powerSave = powerSave;
      this.network = network;
      this.unmetered = unmetered;
    }
  }

  private boolean active;

  /** Evaluates and remembers whether work is active, for the temperature hysteresis. */
  public synchronized Reason evaluate(boolean optedIn, boolean executionAdmitted, Conditions c) {
    Reason reason = reason(optedIn, executionAdmitted, c, active);
    active = reason == Reason.ELIGIBLE;
    return reason;
  }

  static Reason reason(boolean optedIn, boolean executionAdmitted, Conditions c, boolean active) {
    if (!optedIn) return Reason.NOT_OPTED_IN;
    if (!executionAdmitted) return Reason.EXECUTION_NOT_ADMITTED;
    if (c == null || !c.charging) return Reason.NOT_CHARGING;
    if (c.batteryPercent == UNKNOWN || c.batteryPercent < MIN_BATTERY_PERCENT) return Reason.BATTERY_LOW;
    if (c.batteryTenthsCelsius == UNKNOWN) return Reason.BATTERY_TEMPERATURE_UNKNOWN;
    if (c.batteryTenthsCelsius >= (active ? STOP_AT_TENTHS_C : START_BELOW_TENTHS_C)) return Reason.BATTERY_HOT;
    if (c.thermalStatus != UNKNOWN && c.thermalStatus > MAX_THERMAL_STATUS) return Reason.DEVICE_HOT;
    if (c.powerSave) return Reason.POWER_SAVE;
    if (!c.network) return Reason.NO_NETWORK;
    if (!c.unmetered) return Reason.METERED_NETWORK;
    return Reason.ELIGIBLE;
  }

  /**
   * The model id to advertise, or null. Requires the gate, a hash-verified
   * artifact and a passing on-device canary; PHONE_EXECUTION_ADMITTED is still
   * false, so the gate refuses before reaching the other checks.
   */
  public static String advertisedModel(Reason gate, boolean artifactVerified, boolean canaryPassed) {
    return gate == Reason.ELIGIBLE && artifactVerified && canaryPassed ? MemoryEmbeddingPins.MODEL : null;
  }
}
