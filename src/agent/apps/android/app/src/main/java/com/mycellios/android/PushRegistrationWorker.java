package com.mycellios.android;
import android.content.Context;
import androidx.work.*;
public final class PushRegistrationWorker extends Worker {
  public PushRegistrationWorker(Context context,WorkerParameters params){super(context,params);}
  @Override public Result doWork(){
    Context c=getApplicationContext();String owner=NativePush.owner(c);long epoch=NativePush.epoch(c);
    if(owner.isEmpty() || !NativePush.configured() || !NativePush.allowed(c))return Result.success();
    try { return NativePush.register(c,owner,epoch)?Result.success():Result.failure(); }
    catch(SecurityException e){if(epoch==NativePush.epoch(c))NativePush.clear(c);return Result.failure();}
    catch(Exception e){return getRunAttemptCount()<5?Result.retry():Result.failure();}
  }
}
