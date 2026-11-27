import { describe, expect, it } from 'vitest';
import {
  classifyKeepAliveResult,
  extractSesskeyFromHtml,
  siteKeyFromOrigin
} from '../../src/core/keepalive';

describe('Moodle keep-alive classifier', () => {
  it('maps HUJI Moodle origins to site keys', () => {
    expect(siteKeyFromOrigin('https://moodle.huji.ac.il/2026-27/my/')).toBe('moodle');
    expect(siteKeyFromOrigin('https://moodle2.cs.huji.ac.il/course/view.php')).toBe('csMoodle');
    expect(siteKeyFromOrigin('https://example.com')).toBeNull();
  });

  it('detects opaqueredirect or SAML redirect as logged_out', () => {
    expect(classifyKeepAliveResult({ status: 0, type: 'opaqueredirect' }).outcome).toBe('logged_out');
    expect(
      classifyKeepAliveResult({
        status: 200,
        redirected: true,
        url: 'https://idp.cc.huji.ac.il/simplesaml/module.php/hujicc/login'
      }).outcome
    ).toBe('logged_out');
  });

  it('recognizes core_session_touch success JSON', () => {
    expect(
      classifyKeepAliveResult({
        status: 200,
        jsonPayload: [{ error: false, data: true }]
      }).outcome
    ).toBe('ok');
  });

  it('triggers fallback GET when sesskey is invalid', () => {
    expect(
      classifyKeepAliveResult({
        status: 200,
        jsonPayload: [{ error: true, exception: { errorcode: 'invalidsesskey' } }]
      }).outcome
    ).toBe('retry_get');
  });

  it('flags servicerequireslogin JSON as logged_out', () => {
    expect(
      classifyKeepAliveResult({
        status: 200,
        jsonPayload: [{ error: true, exception: { errorcode: 'servicerequireslogin' } }]
      }).outcome
    ).toBe('logged_out');
  });

  it('extracts sesskey from Moodle HTML and confirms ok', () => {
    const html = '<a href="https://moodle.huji.ac.il/2026-27/login/logout.php?sesskey=AbCdEf1234">Log out</a>';
    expect(extractSesskeyFromHtml(html)).toBe('AbCdEf1234');
    expect(
      classifyKeepAliveResult({
        status: 200,
        url: 'https://moodle.huji.ac.il/2026-27/my/',
        bodyText: html
      })
    ).toEqual({ outcome: 'ok', sesskey: 'AbCdEf1234' });
  });
});
