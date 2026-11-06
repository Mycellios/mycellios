package com.mycellios.android;
import static org.junit.Assert.*;
import org.junit.Test;
public class NavigationPolicyTest {
 @Test public void admitsOnlyPackagedChatForMicrophone() {
  assertTrue(NavigationPolicy.mayRecord("https://www.mycellios.com/agent/app?m=owned"));
  for(String s:new String[]{"http://www.mycellios.com/agent/app","https://www.mycellios.com.evil/agent/app","https://evil@www.mycellios.com/agent/app","https://www.mycellios.com:444/agent/app","https://www.mycellios.com/agent/auth/v1/login","https://www.mycellios.com/agent/api/auth","https://www.mycellios.com/agent/%61pp","https://www.mycellios.com/agent/app/../api"}) assertFalse(s,NavigationPolicy.mayRecord(s));
 }
 @Test public void authenticationNeverReceivesMicrophone() {
  assertTrue(NavigationPolicy.appRoute("https://www.mycellios.com/agent/auth"));
  assertFalse(NavigationPolicy.mayRecord("https://www.mycellios.com/agent/auth"));
  assertFalse(NavigationPolicy.appRoute("https://www.mycellios.com/agent/auth/v1/oauth/authorize"));
 }
 @Test public void bootstrapIsOutsideThePwaScopeAndNeverGetsMicrophone() {
  assertFalse(NavigationPolicy.appRoute(NavigationPolicy.BOOTSTRAP));
  assertFalse(NavigationPolicy.mayRecord(NavigationPolicy.BOOTSTRAP));
  assertTrue(NavigationPolicy.blockedWorker("https://www.mycellios.com/agent/sw.js?update=1"));
  assertFalse(NavigationPolicy.blockedWorker("https://other.example/agent/sw.js"));
 }
}
