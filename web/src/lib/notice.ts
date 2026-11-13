// The shared "Your forecast needs attention" notice: what it says, worked out
// from app state (a missing exchange rate or an engine error).

export type ForecastNotice =
  | { kind: 'rate'; currency: string; fetching: boolean }
  | { kind: 'error'; detail: string }
  | null;

/**
 * What the notice shows. A missing rate comes first (the user can type it in
 * right there); `fetching` lists the currencies whose online lookup is still
 * running, so the notice doesn't say the lookup failed before it has.
 */
export function forecastNotice(
  missingRate: string | null,
  fetching: readonly string[],
  error: { detail: string } | null,
): ForecastNotice {
  if (missingRate) return { kind: 'rate', currency: missingRate, fetching: fetching.includes(missingRate) };
  if (error) return { kind: 'error', detail: error.detail };
  return null;
}

export function rateNoticeText(currency: string, fetching: boolean): string {
  return fetching
    ? `Getting the latest ${currency} rate…`
    : `There’s no saved ${currency} to peso rate yet, and Lantaw couldn’t get one online. Type today’s rate to update your forecast.`;
}
