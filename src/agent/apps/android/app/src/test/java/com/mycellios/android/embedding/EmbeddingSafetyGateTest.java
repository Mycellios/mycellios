package com.mycellios.android.embedding;

import static org.junit.Assert.*;

import com.mycellios.android.embedding.EmbeddingSafetyGate.Conditions;
import com.mycellios.android.embedding.EmbeddingSafetyGate.Reason;
import org.junit.Test;

public class EmbeddingSafetyGateTest {
  private static final int U = EmbeddingSafetyGate.UNKNOWN;

  private static Conditions safe(int tenthsC) {
    return new Conditions(true, 80, tenthsC, 0, false, true, true);
  }

  @Test public void eligibleOnlyWhenEveryConditionHolds() {
    assertEquals(Reason.ELIGIBLE, new EmbeddingSafetyGate().evaluate(true, true, safe(300)));
  }

  @Test public void eachConditionBlocks() {
    assertEquals(Reason.NOT_OPTED_IN, EmbeddingSafetyGate.reason(false, true, safe(300), false));
    assertEquals(Reason.EXECUTION_NOT_ADMITTED, EmbeddingSafetyGate.reason(true, false, safe(300), false));
    assertEquals(Reason.NOT_CHARGING, EmbeddingSafetyGate.reason(true, true, new Conditions(false, 80, 300, 0, false, true, true), false));
    assertEquals(Reason.NOT_CHARGING, EmbeddingSafetyGate.reason(true, true, null, false));
    assertEquals(Reason.BATTERY_LOW, EmbeddingSafetyGate.reason(true, true, new Conditions(true, 49, 300, 0, false, true, true), false));
    assertEquals(Reason.BATTERY_LOW, EmbeddingSafetyGate.reason(true, true, new Conditions(true, U, 300, 0, false, true, true), false));
    assertEquals(Reason.BATTERY_TEMPERATURE_UNKNOWN, EmbeddingSafetyGate.reason(true, true, safe(U), false));
    assertEquals(Reason.BATTERY_HOT, EmbeddingSafetyGate.reason(true, true, safe(360), false));
    assertEquals(Reason.DEVICE_HOT, EmbeddingSafetyGate.reason(true, true, new Conditions(true, 80, 300, 2, false, true, true), false));
    assertEquals(Reason.ELIGIBLE, EmbeddingSafetyGate.reason(true, true, new Conditions(true, 80, 300, U, false, true, true), false));
    assertEquals(Reason.POWER_SAVE, EmbeddingSafetyGate.reason(true, true, new Conditions(true, 80, 300, 0, true, true, true), false));
    assertEquals(Reason.NO_NETWORK, EmbeddingSafetyGate.reason(true, true, new Conditions(true, 80, 300, 0, false, false, true), false));
    assertEquals(Reason.METERED_NETWORK, EmbeddingSafetyGate.reason(true, true, new Conditions(true, 80, 300, 0, false, true, false), false));
  }

  @Test public void batteryTemperatureUsesHysteresis() {
    EmbeddingSafetyGate gate = new EmbeddingSafetyGate();
    assertEquals(Reason.BATTERY_HOT, gate.evaluate(true, true, safe(365)));
    assertEquals(Reason.ELIGIBLE, gate.evaluate(true, true, safe(355)));
    // Once serving, it keeps going until the stop threshold.
    assertEquals(Reason.ELIGIBLE, gate.evaluate(true, true, safe(375)));
    assertEquals(Reason.BATTERY_HOT, gate.evaluate(true, true, safe(380)));
    // After stopping it must cool below the start threshold again.
    assertEquals(Reason.BATTERY_HOT, gate.evaluate(true, true, safe(370)));
    assertEquals(Reason.ELIGIBLE, gate.evaluate(true, true, safe(359)));
  }

  @Test public void advertisesOnlyAfterGateArtifactAndCanary() {
    assertEquals(MemoryEmbeddingPins.MODEL, EmbeddingSafetyGate.advertisedModel(Reason.ELIGIBLE, true, true));
    assertNull(EmbeddingSafetyGate.advertisedModel(Reason.ELIGIBLE, false, true));
    assertNull(EmbeddingSafetyGate.advertisedModel(Reason.ELIGIBLE, true, false));
    assertNull(EmbeddingSafetyGate.advertisedModel(Reason.METERED_NETWORK, true, true));
  }

  @Test public void unqualifiedPhonesNeverAdvertise() {
    assertFalse(MemoryEmbeddingPins.PHONE_EXECUTION_ADMITTED);
    Reason gate = new EmbeddingSafetyGate().evaluate(true, MemoryEmbeddingPins.PHONE_EXECUTION_ADMITTED, safe(300));
    assertNull(EmbeddingSafetyGate.advertisedModel(gate, true, true));
  }
}
