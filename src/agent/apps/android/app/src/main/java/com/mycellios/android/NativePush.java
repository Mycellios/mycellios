package com.mycellios.android;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.CookieManager;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.android.gms.tasks.Tasks;
import androidx.work.*;
import androidx.core.app.NotificationCompat;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.TimeUnit;

public final class NativePush {
  public static final String CLICK="com.mycellios.android.NOTIFICATION", URL="notificationUrl", OWNER="notificationOwner";
  private static final String CHANNEL="mico-activity", RPC="https://www.mycellios.com/agent/rpc/notifications/registerAndroidPush";
  private static volatile boolean foreground;
  private static android.content.SharedPreferences prefs(Context c){return c.getSharedPreferences("mycellios-native-push",Context.MODE_PRIVATE);}
  public static boolean configured(){return !BuildConfig.FIREBASE_PROJECT_ID.isEmpty() && !BuildConfig.FIREBASE_APP_ID.isEmpty() && !BuildConfig.FIREBASE_API_KEY.isEmpty() && !BuildConfig.FIREBASE_SENDER_ID.isEmpty();}
  public static synchronized void initialize(Context c){
    c.getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"Mico activity",NotificationManager.IMPORTANCE_DEFAULT));
    if(!configured())return;
    if(FirebaseApp.getApps(c).isEmpty())FirebaseApp.initializeApp(c,new FirebaseOptions.Builder().setProjectId(BuildConfig.FIREBASE_PROJECT_ID).setApplicationId(BuildConfig.FIREBASE_APP_ID).setApiKey(BuildConfig.FIREBASE_API_KEY).setGcmSenderId(BuildConfig.FIREBASE_SENDER_ID).build());
    FirebaseMessaging.getInstance().setAutoInitEnabled(!owner(c).isEmpty());
  }
  public static boolean allowed(Context c){return c.getSystemService(NotificationManager.class).areNotificationsEnabled() && (Build.VERSION.SDK_INT<33 || c.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED);}
  public static String owner(Context c){return prefs(c).getString("owner","");}
  public static void foreground(boolean value){foreground=value;}
  public static synchronized long begin(Context c,String owner){
    long epoch=prefs(c).getLong("epoch",0)+1;
    if(!owner.equals(owner(c)))c.getSystemService(NotificationManager.class).cancelAll();
    prefs(c).edit().putLong("epoch",epoch).remove("owner").commit(); return epoch;
  }
  public static synchronized void clear(Context c){
    prefs(c).edit().putLong("epoch",prefs(c).getLong("epoch",0)+1).remove("owner").remove("receipts").commit();
    c.getSystemService(NotificationManager.class).cancelAll();
    WorkManager.getInstance(c).cancelUniqueWork("mycellios-push-registration");
    if(configured()) { FirebaseMessaging.getInstance().setAutoInitEnabled(false); FirebaseMessaging.getInstance().deleteToken(); }
  }
  public static synchronized void preferences(Context c,JSONObject value){
    long until=Math.min(System.currentTimeMillis()+7*86400000L,Math.max(0,value.optLong("mutedUntil",0)));
    prefs(c).edit().putBoolean("preview",value.optBoolean("preview",false)).putBoolean("sound",value.optBoolean("sound",true))
      .putBoolean("attention",value.optBoolean("attentionOnly",false)).putLong("mutedUntil",until).commit();
  }
  /** Runs off the main thread. 401/403 are permanent; no token is ever returned to JavaScript. */
  public static boolean register(Context c,String account,long epoch) throws Exception {
    if(!configured() || !allowed(c))throw new IOException("Android notifications are not configured or allowed.");
    initialize(c);
    String cookies=CookieManager.getInstance().getCookie("https://www.mycellios.com/agent/");
    if(cookies==null || cookies.isEmpty())throw new SecurityException("Sign in again before enabling notifications.");
    String token=Tasks.await(FirebaseMessaging.getInstance().getToken(),25,TimeUnit.SECONDS);
    if(token==null || token.length()<20 || token.length()>4096)throw new IOException("Could not obtain an Android push token.");
    HttpURLConnection conn=(HttpURLConnection)new URL(RPC).openConnection();
    conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(10000);conn.setReadTimeout(15000);conn.setRequestMethod("POST");conn.setDoOutput(true);
    conn.setRequestProperty("Cookie",cookies);conn.setRequestProperty("Origin","https://www.mycellios.com");conn.setRequestProperty("Content-Type","application/json");
    byte[] body=new JSONObject().put("json",new JSONObject().put("token",token).put("expectedUserId",account).put("projectId",BuildConfig.FIREBASE_PROJECT_ID)).toString().getBytes(StandardCharsets.UTF_8);
    try {
      conn.setFixedLengthStreamingMode(body.length);try(OutputStream out=conn.getOutputStream()){out.write(body);}
      int status=conn.getResponseCode();
      if(status==401 || status==403)throw new SecurityException("Sign in again before enabling notifications.");
      if(status!=200)throw new IOException("The server could not register Android push.");
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=conn.getInputStream()){byte[] chunk=new byte[1024];int count;while((count=in.read(chunk))!=-1){if(bytes.size()+count>16384)throw new IOException("Invalid registration response.");bytes.write(chunk,0,count);}}
      if(!new JSONObject(bytes.toString("UTF-8")).getJSONObject("json").optBoolean("ok"))throw new IOException("Android push registration was not confirmed.");
      synchronized(NativePush.class){
        if(epoch!=prefs(c).getLong("epoch",0) || !cookies.equals(CookieManager.getInstance().getCookie("https://www.mycellios.com/agent/")))return false;
        prefs(c).edit().putString("owner",account).commit(); FirebaseMessaging.getInstance().setAutoInitEnabled(true);
      }
      return true;
    } finally { conn.disconnect(); }
  }
  public static void scheduleRefresh(Context c){
    if(owner(c).isEmpty() || !configured() || !allowed(c))return;
    WorkManager.getInstance(c).enqueueUniqueWork("mycellios-push-registration",ExistingWorkPolicy.REPLACE,
      new OneTimeWorkRequest.Builder(PushRegistrationWorker.class).setConstraints(new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,30,TimeUnit.SECONDS).build());
  }
  public static long epoch(Context c){return prefs(c).getLong("epoch",0);}
  public static synchronized void receive(Context c,Map<String,String> data,boolean test){
    String url=NotificationPolicy.target(data,owner(c),System.currentTimeMillis());
    if(url==null || !allowed(c) || (!test && foreground))return;
    android.content.SharedPreferences prefs=prefs(c);
    if(!test && (prefs.getLong("mutedUntil",0)>System.currentTimeMillis() || prefs.getBoolean("attention",false)&&"completion".equals(data.get("kind"))))return;
    try {
      JSONArray receipts=new JSONArray(prefs.getString("receipts","[]"));
      for(int i=0;i<receipts.length();i++)if(data.get("deliveryId").equals(receipts.optString(i)))return;
      if(test)url="https://www.mycellios.com/agent/app";
      Intent intent=new Intent(c,MainActivity.class).setAction(CLICK).putExtra(URL,url).putExtra(OWNER,owner(c)).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
      int id=data.get("threadId").hashCode();
      PendingIntent click=PendingIntent.getActivity(c,id,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
      boolean preview=prefs.getBoolean("preview",false);
      boolean es=c.getResources().getConfiguration().getLocales().get(0).getLanguage().equals("es");
      String body=preview?NotificationPolicy.text(data.get("body"),180):(es?"Tu Mico tiene novedades. Abre el chat para verlas.":"Your Mico has an update. Open the chat to see it.");
      Notification notification=new NotificationCompat.Builder(c,CHANNEL).setSmallIcon(R.drawable.ic_notification)
        .setContentTitle(preview?NotificationPolicy.text(data.get("title"),100):"Mycellios").setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body))
        .setContentIntent(click).setAutoCancel(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE).setSilent(!prefs.getBoolean("sound",true)).build();
      c.getSystemService(NotificationManager.class).notify(id,notification);
      JSONArray next=new JSONArray();for(int i=Math.max(0,receipts.length()-99);i<receipts.length();i++)next.put(receipts.get(i));next.put(data.get("deliveryId"));prefs.edit().putString("receipts",next.toString()).commit();
    } catch(Exception ignored){ /* Payload and credentials must not enter Android logs. */ }
  }
  public static void test(Context c) throws Exception {
    if(owner(c).isEmpty() || !allowed(c))throw new IOException("Enable and register Android notifications first.");
    Map<String,String> data=new HashMap<>();data.put("version","1");data.put("deliveryId",java.util.UUID.randomUUID().toString().replace("-","")+java.util.UUID.randomUUID().toString().replace("-",""));
    data.put("accountId",owner(c));data.put("botId","test");data.put("threadId","test");data.put("spaceId","personal");data.put("kind","help");data.put("title","Mycellios");data.put("body","Notifications test");data.put("expiresAt",String.valueOf(System.currentTimeMillis()+300000));receive(c,data,true);
  }
}
