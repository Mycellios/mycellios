package com.mycellios.android;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
public final class PushMessagingService extends FirebaseMessagingService {
  @Override public void onMessageReceived(RemoteMessage message){NativePush.receive(this,message.getData(),false);}
  @Override public void onNewToken(String token){NativePush.scheduleRefresh(this);}
}
