import { ext } from '../shared/browser';
import { inspectMoodleDom } from './moodle-keepalive-core';

const report = inspectMoodleDom(document, location.href);
void Promise.resolve(
  ext.runtime.sendMessage({
    type: 'REPORT_MOODLE_SESSION',
    ...report
  })
).catch(() => {});
