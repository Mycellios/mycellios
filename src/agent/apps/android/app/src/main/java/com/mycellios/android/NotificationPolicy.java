package com.mycellios.android;

import java.net.URI;
import java.util.Map;

/** No Android framework dependency: test payload admission and navigation as plain Java. */
public final class NotificationPolicy {
  private static boolean id(String value) { return value!=null && value.matches("[a-zA-Z0-9_-]{1,160}"); }
  public static String target(Map<String,String> data,String owner,long now) {
    if(owner==null || owner.isEmpty() || !owner.equals(data.get("accountId")) || !"1".equals(data.get("version")))return null;
    if(data.get("deliveryId")==null || !data.get("deliveryId").matches("[a-f0-9]{64}"))return null;
    try { long expires=Long.parseLong(data.get("expiresAt")); if(expires<=now || expires>now+360000)return null; } catch(Exception e){return null;}
    if(!id(data.get("botId")) || !id(data.get("threadId")) || !id(data.get("spaceId")))return null;
    String group=data.get("groupId"),task=data.get("taskThreadId");
    if(group!=null && !id(group) || task!=null && !id(task))return null;
    String path=group!=null?"/agent/app/g/"+group:"/agent/app/"+data.get("botId");
    return "https://www.mycellios.com"+path+"?noticeSpace="+data.get("spaceId")+(group==null && task!=null?"&task="+task:"");
  }
  /** A close for a request answered on another device: the thread whose notice to close, or null. */
  public static String dismissal(Map<String,String> data,String owner,long now) {
    if(!"dismiss".equals(data.get("type")) || owner==null || owner.isEmpty() || !owner.equals(data.get("accountId")) || !"1".equals(data.get("version")))return null;
    if(data.get("deliveryId")==null || !data.get("deliveryId").matches("[a-f0-9]{64}"))return null;
    try { long expires=Long.parseLong(data.get("expiresAt")); if(expires<=now || expires>now+360000)return null; } catch(Exception e){return null;}
    return id(data.get("threadId")) && id(data.get("requestId"))?data.get("threadId"):null;
  }
  /** Saved pause end: a far-future value from "until turned back on" stays; others last at most seven days. */
  public static long pauseUntil(long requested,long now) {
    if(requested>=PAUSED_UNTIL_RESUMED)return Long.MAX_VALUE;
    return Math.min(now+7*86400000L,Math.max(0,requested));
  }
  /** 9999-12-31T23:59:59.999Z, the value the app stores for a pause without an end. */
  public static final long PAUSED_UNTIL_RESUMED=253402300799999L;
  public static boolean clickTarget(String value) {
    if(value==null || value.length()>800 || !NavigationPolicy.trustedOrigin(value))return false;
    try {
      URI uri=URI.create(value);
      if(uri.getRawFragment()!=null || !uri.getRawPath().matches("/agent/app(?:/(?:g/)?[a-zA-Z0-9_-]{1,160})?"))return false;
      java.util.HashSet<String> used=new java.util.HashSet<>();
      if(uri.getRawQuery()!=null)for(String part:uri.getRawQuery().split("&",-1)){
        String[] pair=part.split("=",-1); if(pair.length!=2 || !used.add(pair[0]) || !(pair[0].equals("noticeSpace")||pair[0].equals("task")||pair[0].equals("m")) || !id(pair[1]))return false;
      }
      return true;
    }catch(Exception e){return false;}
  }
  public static String text(String value,int max) {
    if(value==null)return "";
    String clean=value.replaceAll("[\\p{Cntrl}]"," "); return clean.substring(0,Math.min(max,clean.length()));
  }
}
