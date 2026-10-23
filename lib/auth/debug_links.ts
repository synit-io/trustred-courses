import { env, isDebugLinkExposureEnabled } from "../env.ts";

/** Query-provided debug links follow the same policy as token issuance. */
export function validatedDebugLink(
  value: string | undefined,
  expectedPath: string,
): string | null {
  if (!value || !isDebugLinkExposureEnabled()) return null;
  try {
    const base = new URL(env.appBaseUrl);
    const url = new URL(value, base);
    if (
      url.origin !== base.origin || url.pathname !== expectedPath ||
      url.username || url.password || url.hash ||
      !["http:", "https:"].includes(url.protocol) ||
      !url.searchParams.get("token")
    ) return null;
    return url.href;
  } catch {
    return null;
  }
}
