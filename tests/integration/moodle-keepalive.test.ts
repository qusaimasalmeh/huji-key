import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectMoodleDom } from '../../src/content/moodle-keepalive-core';

describe('Moodle DOM session detection', () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;

  afterEach(() => {
    (globalThis as { chrome?: unknown }).chrome = originalChrome;
    globalThis.document = originalDocument;
    globalThis.location = originalLocation;
  });
  it('detects logged-in Moodle session and extracts sesskey', () => {
    const dom = new JSDOM(
      `<div class="usermenu"><a href="https://moodle.huji.ac.il/2026-27/login/logout.php?sesskey=xyz987">Log out</a></div>`,
      { url: 'https://moodle.huji.ac.il/2026-27/my/' }
    );
    expect(inspectMoodleDom(dom.window.document, 'https://moodle.huji.ac.il/2026-27/my/')).toEqual({
      origin: 'https://moodle.huji.ac.il',
      loggedIn: true,
      sesskey: 'xyz987'
    });
  });

  it('detects Moodle login page as logged_out', () => {
    const dom = new JSDOM('<form id="login"></form>', {
      url: 'https://moodle.huji.ac.il/2026-27/login/index.php'
    });
    expect(
      inspectMoodleDom(dom.window.document, 'https://moodle.huji.ac.il/2026-27/login/index.php')
    ).toEqual({
      origin: 'https://moodle.huji.ac.il',
      loggedIn: false
    });
  });

  it('detects logged-in CS Moodle via user shell and hidden sesskey input', () => {
    const dom = new JSDOM(
      `<div id="user-menu-toggle">Student</div><input type="hidden" name="sesskey" value="csKey42" />`,
      { url: 'https://moodle2.cs.huji.ac.il/nu25/my/' }
    );
    expect(
      inspectMoodleDom(dom.window.document, 'https://moodle2.cs.huji.ac.il/nu25/my/')
    ).toEqual({
      origin: 'https://moodle2.cs.huji.ac.il',
      loggedIn: true,
      sesskey: 'csKey42'
    });
  });

  it('entrypoint reports Moodle session via runtime.sendMessage', async () => {
    const dom = new JSDOM(
      `<div class="usermenu"><a href="https://moodle.huji.ac.il/2026-27/login/logout.php?sesskey=rep123">Log out</a></div>`,
      { url: 'https://moodle.huji.ac.il/2026-27/my/' }
    );
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const origDocument = globalThis.document;
    const origLocation = globalThis.location;

    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: { local: {}, session: {} },
      runtime: { sendMessage }
    };

    try {
      globalThis.document = dom.window.document;
      globalThis.location = dom.window.location;
      vi.resetModules();
      await import('../../src/content/moodle-keepalive');

      expect(sendMessage).toHaveBeenCalledWith({
        type: 'REPORT_MOODLE_SESSION',
        origin: 'https://moodle.huji.ac.il',
        loggedIn: true,
        sesskey: 'rep123'
      });
    } finally {
      globalThis.document = origDocument;
      globalThis.location = origLocation;
    }
  });

  it('treats guest [data-userid="0"] and bare sesskey without user shell as logged_out, while ignoring /login/ in query string', () => {
    const guestDom = new JSDOM(
      `<body data-userid="0"><script>var M = {"cfg":{"sesskey":"guestKey1"}};</script></body>`,
      { url: 'https://moodle.huji.ac.il/' }
    );
    expect(inspectMoodleDom(guestDom.window.document, 'https://moodle.huji.ac.il/')).toEqual({
      origin: 'https://moodle.huji.ac.il',
      loggedIn: false
    });

    const bareSesskeyDom = new JSDOM(
      `<main><input type="hidden" name="sesskey" value="anonKey2" /></main>`,
      { url: 'https://moodle.huji.ac.il/course/index.php' }
    );
    expect(
      inspectMoodleDom(bareSesskeyDom.window.document, 'https://moodle.huji.ac.il/course/index.php')
    ).toEqual({
      origin: 'https://moodle.huji.ac.il',
      loggedIn: false
    });

    const queryLoginDom = new JSDOM(
      `<div data-userid="42"><a href="/login/logout.php?sesskey=realUser1">Out</a></div>`,
      { url: 'https://moodle.huji.ac.il/course/view.php?wantsurl=%2Flogin%2Findex.php' }
    );
    expect(
      inspectMoodleDom(
        queryLoginDom.window.document,
        'https://moodle.huji.ac.il/course/view.php?wantsurl=%2Flogin%2Findex.php'
      )
    ).toEqual({
      origin: 'https://moodle.huji.ac.il',
      loggedIn: true,
      sesskey: 'realUser1'
    });
  });
});
