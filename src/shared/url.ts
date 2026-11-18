/** Adds https:// to a link typed without a scheme ("fathom.com", "www.fathom.com"). */
export const withScheme = (v: string) =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v.replace(/^\/+/, '')}`;
