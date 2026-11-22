package com.mycellios.android;

import org.junit.Test;
import static org.junit.Assert.*;
import java.util.HashMap;
import java.util.Map;

public class NotificationPolicyTest {
  private Map<String,String> payload(){
    Map<String,String> value=new HashMap<>();
    value.put("version","1");value.put("accountId","owner");value.put("deliveryId","a".repeat(64));
    value.put("expiresAt","301000");value.put("botId","bot");value.put("threadId","thread");value.put("spaceId","space");return value;
  }
  @Test public void bindsOwnerAndExpires(){
    assertNotNull(NotificationPolicy.target(payload(),"owner",1000));
    assertNull(NotificationPolicy.target(payload(),"other",1000));
    assertNull(NotificationPolicy.target(payload(),"",1000));
    assertNull(NotificationPolicy.target(payload(),"owner",301000));
    assertNull(NotificationPolicy.target(payload(),"owner",-100000));
  }
  @Test public void routesTasksAndGroupsInsideTheApp(){
    Map<String,String> value=payload();value.put("taskThreadId","task");
    assertEquals("https://www.mycellios.com/agent/app/bot?noticeSpace=space&task=task",NotificationPolicy.target(value,"owner",1000));
    value.put("groupId","group");
    String target=NotificationPolicy.target(value,"owner",1000);
    assertEquals("https://www.mycellios.com/agent/app/g/group?noticeSpace=space",target);
    assertTrue(NotificationPolicy.clickTarget(target));
  }
  @Test public void rejectsEscapesAndAmbiguousTargets(){
    for(String value:new String[]{"https://evil.example/agent/app/bot", "https://www.mycellios.com.evil.example/agent/app", "https://www.mycellios.com/agent/app/../settings", "https://www.mycellios.com/agent/app/bot?noticeSpace=a&noticeSpace=b", "https://www.mycellios.com/agent/app/bot?task=%2f", "https://www.mycellios.com/agent/app/bot#other"})assertFalse(value,NotificationPolicy.clickTarget(value));
    Map<String,String> value=payload();value.put("botId","../settings");assertNull(NotificationPolicy.target(value,"owner",1000));
    value=payload();value.put("deliveryId","bad");assertNull(NotificationPolicy.target(value,"owner",1000));
  }
  private Map<String,String> dismissal(){
    Map<String,String> value=new HashMap<>();
    value.put("version","1");value.put("type","dismiss");value.put("accountId","owner");value.put("deliveryId","b".repeat(64));
    value.put("expiresAt","301000");value.put("threadId","thread");value.put("requestId","event-1");return value;
  }
  @Test public void closesOnlyOwnedAnsweredRequests(){
    assertEquals("thread",NotificationPolicy.dismissal(dismissal(),"owner",1000));
    assertNull(NotificationPolicy.dismissal(dismissal(),"other",1000));
    assertNull(NotificationPolicy.dismissal(dismissal(),"owner",301000));
    Map<String,String> value=dismissal();value.put("requestId","../x");assertNull(NotificationPolicy.dismissal(value,"owner",1000));
    value=dismissal();value.remove("type");assertNull(NotificationPolicy.dismissal(value,"owner",1000));
    // A close never opens anything: it lacks the fields a shown notice needs.
    assertNull(NotificationPolicy.target(dismissal(),"owner",1000));
  }
  @Test public void keepsAnIndefinitePauseAndBoundsTimedOnes(){
    assertEquals(Long.MAX_VALUE,NotificationPolicy.pauseUntil(NotificationPolicy.PAUSED_UNTIL_RESUMED,1000));
    assertEquals(1000+7*86400000L,NotificationPolicy.pauseUntil(1000+30*86400000L,1000));
    assertEquals(5000,NotificationPolicy.pauseUntil(5000,1000));
    assertEquals(0,NotificationPolicy.pauseUntil(-5,1000));
  }
}
