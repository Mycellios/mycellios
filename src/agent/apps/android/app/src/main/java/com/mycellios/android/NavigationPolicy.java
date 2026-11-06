package com.mycellios.android;
import java.net.URI;

/** Only packaged first-party app routes receive native speech capabilities. */
public final class NavigationPolicy {
  public static final String BOOTSTRAP="https://www.mycellios.com/__mycellios_android_bootstrap";
  public static boolean blockedWorker(String value) {
    return trustedOrigin(value) && "/agent/sw.js".equals(URI.create(value).getRawPath());
  }
  public static boolean trustedOrigin(String value) {
    try { URI u=URI.create(value); return "https".equals(u.getScheme()) && "www.mycellios.com".equals(u.getHost()) && (u.getPort()==-1 || u.getPort()==443) && u.getRawUserInfo()==null; }
    catch (RuntimeException e) { return false; }
  }
  public static boolean appRoute(String value) {
    if (!trustedOrigin(value)) return false;
    String path=URI.create(value).getRawPath();
    if (path==null || path.contains("%") || path.contains("..") || path.contains("\\")) return false;
    return path.equals("/agent/") || path.equals("/agent/app") || path.equals("/agent/auth") || path.equals("/agent/sign-in") || path.equals("/agent/sign-up") || path.equals("/agent/sso/callback") || path.equals("/agent/onboarding") || path.equals("/agent/welcome") || path.startsWith("/agent/artifacts/") || path.equals("/agent/board") || path.startsWith("/agent/app/") || path.startsWith("/agent/onboarding/") || path.equals("/agent/forgot-password") || path.equals("/agent/reset-password") || path.equals("/agent/mcp/oauth/callback") || path.equals("/agent/integrations/setup") || path.equals("/agent/integrations/callback");
  }
  public static boolean mayRecord(String value) {
    return appRoute(value) && (URI.create(value).getRawPath().equals("/agent/app") || URI.create(value).getRawPath().matches("/agent/app/(?!artifacts$|board$|g$)[a-zA-Z0-9_-]+"));
  }
}
