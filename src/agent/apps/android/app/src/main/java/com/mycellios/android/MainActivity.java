package com.mycellios.android;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.webkit.*;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.ServiceWorkerControllerCompat;
import androidx.webkit.ServiceWorkerClientCompat;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Android owns permissions and speech; the packaged web app owns every product screen. */
public class MainActivity extends Activity {
  private static final String HOME="https://www.mycellios.com/agent/app", ACTION="com.mycellios.android.DICTATE";
  private final Handler handler=new Handler(Looper.getMainLooper());
  private final Set<String> assets=new HashSet<>();
  private WebView web;
  private JavaScriptReplyProxy page;
  private SpeechRecognizer speech;
  private String captureId, partial="";
  private long shortcutUntil, captureDeadline;
  private boolean foreground, awaitingPermission, permissionReady, chatReady;
  private ValueCallback<Uri[]> files;
  private PermissionRequest webPermission;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    web=new WebView(this);
    FrameLayout frame=new FrameLayout(this);frame.setBackgroundColor(0xfff8f6f2);
    frame.addView(web,new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,FrameLayout.LayoutParams.MATCH_PARENT));
    // WebView padding does not resize its HTML viewport. Reserve real parent space.
    if(android.os.Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);
    getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
    frame.setOnApplyWindowInsetsListener((view,insets)->{
      if(android.os.Build.VERSION.SDK_INT>=30){android.graphics.Insets system=insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime());view.setPadding(system.left,system.top,system.right,system.bottom);return android.view.WindowInsets.CONSUMED;}
      view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();
    });
    web.setBackgroundColor(0xfff8f6f2);
    WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
    s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setMediaPlaybackRequiresUserGesture(true);
    CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
    WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
    try {
      JSONArray manifest=new JSONArray(new String(readAsset("web-files.json"),StandardCharsets.UTF_8));
      for(int i=0;i<manifest.length();i++)assets.add(manifest.getString(i));
    } catch(Exception e) { fatal("The app package is incomplete. Download Mycellios again.");return; }
    if(!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
      fatal("Update Android System WebView or Chrome to use Mycellios.");return;
    }
    if(WebViewFeature.isFeatureSupported(WebViewFeature.SERVICE_WORKER_SHOULD_INTERCEPT_REQUEST)) {
      ServiceWorkerControllerCompat.getInstance().setServiceWorkerClient(new ServiceWorkerClientCompat(){
        @Override public WebResourceResponse shouldInterceptRequest(WebResourceRequest request){return NavigationPolicy.blockedWorker(request.getUrl().toString())?blockedWorker():null;}
      });
    }
    WebViewCompat.addWebMessageListener(web,"MycelliosNative",Collections.singleton("https://www.mycellios.com"),(view,message,origin,mainFrame,reply)->{
      if(!mainFrame || !NavigationPolicy.trustedOrigin(origin.toString()) || !NavigationPolicy.appRoute(web.getUrl()))return;
      String data=message.getData();if(data==null || data.length()>4096)return;
      try {
        JSONObject msg=new JSONObject(data);String type=msg.optString("type"),id=msg.optString("id");
        if(type.equals("ready")){page=reply;return;}
        if(type.equals("chat-ready")){page=reply;chatReady=true;dispatchShortcut();return;}
        if(type.equals("chat-not-ready")){chatReady=false;finishSpeech();return;}
        if(!NavigationPolicy.mayRecord(web.getUrl()) || !id.matches("[a-zA-Z0-9-]{1,64}"))return;
        page=reply;
        if(type.equals("start") && foreground){
          if(captureId!=null)return;
          captureId=id;partial="";captureDeadline=android.os.SystemClock.elapsedRealtime()+30000;
          if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){awaitingPermission=true;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},1);String owner=id;handler.postDelayed(()->{if(awaitingPermission && owner.equals(captureId))finishSpeech();},30000);}
          else startSpeech();
        } else if(id.equals(captureId) && type.equals("finish")){
          if(speech==null){finishSpeech();return;}
          speech.stopListening();String expected=id;
          handler.postDelayed(()->{if(expected.equals(captureId))finishSpeech();},1800);
        } else if(id.equals(captureId) && type.equals("cancel"))stopSpeech();
      }catch(JSONException ignored){}
    });
    web.setWebViewClient(new WebViewClient(){
      @Override public void onPageStarted(WebView v,String url,android.graphics.Bitmap icon){page=null;chatReady=false;stopSpeech();}
      @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){
        if(!request.isForMainFrame())return false;
        String url=request.getUrl().toString();
        if(NavigationPolicy.trustedOrigin(url))return false;
        stopSpeech();page=null;
        if("https".equals(request.getUrl().getScheme()))openExternal(request.getUrl());
        return true;
      }
      @Override public WebResourceResponse shouldInterceptRequest(WebView v,WebResourceRequest request){
        String url=request.getUrl().toString();
        if(!NavigationPolicy.trustedOrigin(url))return null;
        if(NavigationPolicy.blockedWorker(url))return blockedWorker();
        if(request.isForMainFrame() && NavigationPolicy.BOOTSTRAP.equals(url)){
          // This document is outside /agent/, so a prior PWA worker cannot replace it.
          // Unregister only this app profile's disposable Agent transport, not cookies/storage.
          String html="<!doctype html><meta charset=utf-8><title>Mycellios</title><script>"
            +"(async()=>{try{if('serviceWorker'in navigator){const r=await navigator.serviceWorker.getRegistrations();await Promise.all(r.filter(x=>new URL(x.scope).origin===location.origin&&new URL(x.scope).pathname.startsWith('/agent/')).map(x=>x.unregister()));}}catch(e){}location.replace('/agent/app');})()"
            +"</script>";
          return new WebResourceResponse("text/html","UTF-8",200,"OK",responseHeaders(),new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
        }
        String path=request.getUrl().getEncodedPath();
        String relative=path==null?"":path.startsWith("/agent/")?path.substring(7):path.startsWith("/")?path.substring(1):"";
        if(request.isForMainFrame() && NavigationPolicy.appRoute(url))relative="index.html";
        if(!assets.contains(relative))return null;
        try {
          String mime=relative.endsWith(".js")?"text/javascript":relative.endsWith(".css")?"text/css":relative.endsWith(".html")?"text/html":relative.endsWith(".json")?"application/json":relative.endsWith(".woff2")?"font/woff2":relative.endsWith(".svg")?"image/svg+xml":java.net.URLConnection.guessContentTypeFromName(relative);
          return new WebResourceResponse(mime==null?"application/octet-stream":mime,"UTF-8",200,"OK",responseHeaders(),getAssets().open("web/"+relative));
        }catch(IOException e){return new WebResourceResponse("text/plain","UTF-8",404,"Not found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));}
      }
      @Override public void onReceivedSslError(WebView v,android.webkit.SslErrorHandler h,android.net.http.SslError error){h.cancel();}
      @Override public void onReceivedError(WebView v,WebResourceRequest req,WebResourceError error){
        if(req.isForMainFrame())new AlertDialog.Builder(MainActivity.this).setMessage("Could not connect to Mycellios. Check your connection and try again.").setPositiveButton("Try again",(d,w)->web.reload()).setNegativeButton("Close",null).show();
      }
    });
    web.setWebChromeClient(new WebChromeClient(){
      @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{
        if(!foreground || !NavigationPolicy.mayRecord(web.getUrl()) || !NavigationPolicy.trustedOrigin(request.getOrigin().toString()) || !Arrays.equals(request.getResources(),new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE})){request.deny();return;}
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
        else {webPermission=request;requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},2);}
      });}
      @Override public void onPermissionRequestCanceled(PermissionRequest request){if(webPermission==request)webPermission=null;}
      @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> result,FileChooserParams params){
        if(!foreground || !NavigationPolicy.mayRecord(web.getUrl()))return false;
        if(files!=null)files.onReceiveValue(null);files=result;
        try{startActivityForResult(params.createIntent(),3);}catch(Exception e){files.onReceiveValue(null);files=null;}return true;
      }
    });
    web.setDownloadListener((url,agent,disposition,mime,length)->{if(NavigationPolicy.trustedOrigin(url))openExternal(Uri.parse(url));});
    setContentView(frame);frame.requestApplyInsets();publishShortcut();consumeIntent(getIntent());
    // Always cross the worker-free bootstrap after process recreation or an APK update.
    // The shared web app restores the selected Mico, drafts and account from its storage.
    web.loadUrl(NavigationPolicy.BOOTSTRAP);
  }
  private WebResourceResponse blockedWorker(){return new WebResourceResponse("text/javascript","UTF-8",410,"Gone",responseHeaders(),new ByteArrayInputStream(new byte[0]));}
  private byte[] readAsset(String name) throws IOException {try(InputStream input=getAssets().open(name);ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)output.write(buffer,0,count);return output.toByteArray();}}
  private Map<String,String> responseHeaders(){Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");headers.put("X-Content-Type-Options","nosniff");return headers;}
  private void openExternal(Uri uri){try{startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE));}catch(Exception ignored){}}
  private void fatal(String message){new AlertDialog.Builder(this).setMessage(message).setPositiveButton("Close",(d,w)->finish()).show();}
  private void publishShortcut(){
    boolean es=getResources().getConfiguration().getLocales().get(0).getLanguage().equals("es");
    Intent intent=new Intent(this,MainActivity.class).setAction(ACTION).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
    getSystemService(ShortcutManager.class).setDynamicShortcuts(Collections.singletonList(new ShortcutInfo.Builder(this,"dictate").setShortLabel(es?"Dictar":"Dictate").setLongLabel(es?"Dictar a un Mico":"Dictate to a Mico").setIcon(Icon.createWithResource(this,com.mycellios.android.R.drawable.ic_mycellios)).setIntent(intent).build()));
  }
  private void consumeIntent(Intent intent){
    if(ACTION.equals(intent.getAction()) && (intent.getFlags()&Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY)==0){shortcutUntil=android.os.SystemClock.elapsedRealtime()+30000;intent.setAction(Intent.ACTION_MAIN);dispatchShortcut();}
  }
  private void dispatchShortcut(){if(foreground && chatReady && page!=null && NavigationPolicy.mayRecord(web.getUrl()) && shortcutUntil>android.os.SystemClock.elapsedRealtime()){shortcutUntil=0;emit("dictate",null,null,null);}}
  private void emit(String type,String id,String text,String error){
    if(page==null || !NavigationPolicy.appRoute(web.getUrl()))return;
    try{JSONObject msg=new JSONObject().put("type",type);if(id!=null)msg.put("id",id);if(text!=null)msg.put("text",text);if(error!=null)msg.put("error",error);page.postMessage(msg.toString());}catch(Exception ignored){}
  }
  private void startSpeech(){
    if(captureId==null || !foreground || !NavigationPolicy.mayRecord(web.getUrl())){stopSpeech();return;}
    permissionReady=false;if(speech!=null)return;
    if(!SpeechRecognizer.isRecognitionAvailable(this)){speechError("Speech recognition is unavailable. Install or enable your Android speech service.");return;}
    String owner=captureId;
    speech=SpeechRecognizer.createSpeechRecognizer(this);
    speech.setRecognitionListener(new RecognitionListener(){
      boolean current(){return owner.equals(captureId);}
      public void onReadyForSpeech(Bundle b){if(current())web.setKeepScreenOn(true);}
      public void onBeginningOfSpeech(){} public void onRmsChanged(float value){} public void onBufferReceived(byte[] b){} public void onEndOfSpeech(){}
      public void onError(int error){if(current()){if(error==SpeechRecognizer.ERROR_NO_MATCH || error==SpeechRecognizer.ERROR_SPEECH_TIMEOUT)finishSpeech();else speechError(error==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS?"Microphone permission is required. Enable it in Android Settings.":"Speech recognition stopped. Check your connection and try again.");}}
      public void onPartialResults(Bundle b){if(current()){readTranscript(b);emit("partial",captureId,partial,null);}}
      public void onResults(Bundle b){if(current()){readTranscript(b);finishSpeech();}}
      public void onEvent(int event,Bundle b){}
    });
    Intent intent=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS,true).putExtra(RecognizerIntent.EXTRA_LANGUAGE,getResources().getConfiguration().getLocales().get(0).toLanguageTag()).putExtra(RecognizerIntent.EXTRA_MAX_RESULTS,1);
    try{speech.startListening(intent);}catch(Exception e){speechError("Could not start the microphone. Try again.");}
  }
  private void readTranscript(Bundle b){ArrayList<String> values=b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);if(values!=null && !values.isEmpty())partial=values.get(0).substring(0,Math.min(32000,values.get(0).length()));}
  private void finishSpeech(){if(captureId==null)return;String id=captureId,text=partial;stopSpeech();emit("final",id,text,null);}
  private void speechError(String message){String id=captureId;stopSpeech();emit("error",id,null,message);}
  private void stopSpeech(){captureId=null;partial="";permissionReady=false;awaitingPermission=false;if(web!=null)web.setKeepScreenOn(false);if(speech!=null){speech.cancel();speech.destroy();speech=null;}}
  @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);consumeIntent(intent);}
  @Override protected void onResume(){super.onResume();foreground=true;if(web!=null){web.onResume();if(permissionReady){permissionReady=false;if(captureId!=null && captureDeadline>android.os.SystemClock.elapsedRealtime())startSpeech();else finishSpeech();}dispatchShortcut();}}
  @Override protected void onPause(){foreground=false;if(!awaitingPermission)finishSpeech();if(webPermission!=null){webPermission.deny();webPermission=null;}if(web!=null){CookieManager.getInstance().flush();web.onPause();}super.onPause();}
  @Override protected void onDestroy(){stopSpeech();if(web!=null){web.removeAllViews();web.destroy();}super.onDestroy();}
  @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);web.saveState(state);}
  @Override public void onBackPressed(){if(captureId!=null){finishSpeech();return;}if(web.canGoBack())web.goBack();else super.onBackPressed();}
  @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);awaitingPermission=false;
    boolean granted=grants.length>0 && grants[0]==PackageManager.PERMISSION_GRANTED;
    if(request==1 && captureId!=null){if(granted){if(foreground)startSpeech();else permissionReady=true;}else speechError("Microphone permission is required. Try again after allowing it.");}
    if(request==2 && webPermission!=null){if(granted && foreground && NavigationPolicy.mayRecord(web.getUrl()))webPermission.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});else webPermission.deny();webPermission=null;}
  }
  @Override protected void onActivityResult(int request,int result,Intent intent){super.onActivityResult(request,result,intent);if(request==3 && files!=null){files.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,intent));files=null;}}
}
