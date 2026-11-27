import { extractSesskeyFromHtml } from '../core/keepalive';

/** Inspects a Moodle page DOM and URL to determine login status and current sesskey. */
export function inspectMoodleDom(
  doc: Document,
  currentUrl: string
): { origin: string; loggedIn: boolean; sesskey?: string } {
  const origin = new URL(currentUrl).origin;
  const isLoginRoute = currentUrl.includes('/login/');
  const hasLoginForm = Boolean(doc.querySelector('form#login, .loginform'));

  if (isLoginRoute || hasLoginForm) {
    return { origin, loggedIn: false };
  }

  const logoutLink = doc.querySelector(
    'a[href*="logout.php"][href*="sesskey="]'
  ) as HTMLAnchorElement | null;
  const hiddenSesskey = doc.querySelector('input[name="sesskey"]') as HTMLInputElement | null;
  const sesskey =
    (logoutLink ? extractSesskeyFromHtml(logoutLink.href) : undefined) ||
    hiddenSesskey?.value ||
    extractSesskeyFromHtml(doc.documentElement?.innerHTML ?? '');

  const hasUserShell = Boolean(
    logoutLink || doc.querySelector('#user-menu-toggle, .usermenu .userbutton, [data-userid]')
  );

  if (!hasUserShell && !sesskey) {
    return { origin, loggedIn: false };
  }

  return {
    origin,
    loggedIn: true,
    sesskey
  };
}
