package com.mycellios.android;

/** Initialize the owned Firebase app even when Android starts only the push service. */
public final class MycelliosApplication extends android.app.Application {
  @Override public void onCreate() {
    super.onCreate();
    NativePush.initialize(this);
  }
}
