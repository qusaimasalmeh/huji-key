import type { RuntimeMessage } from '../core/types';
import { ext } from '../shared/browser';
import {
  handleRuntimeMessage,
  KEEPALIVE_ALARM_NAME,
  runKeepAliveTick,
  syncKeepAliveAlarm
} from './worker-core';

// All listeners registered synchronously at top level (MV3 requirement)
ext.runtime.onInstalled.addListener(() => {
  void syncKeepAliveAlarm();
});

ext.runtime.onStartup?.addListener(() => {
  void syncKeepAliveAlarm();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM_NAME) {
    void runKeepAliveTick();
  }
});

ext.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  handleRuntimeMessage(message).then(sendResponse);
  return true;
});
