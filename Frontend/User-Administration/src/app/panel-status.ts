import { HttpErrorResponse } from '@angular/common/http';

/**
 * A message a panel shows about one row, or about the panel as a whole when `id` is null — the
 * same split the user list makes between its toolbar status and its per-row password status.
 *
 * It has a file of its own rather than living beside one screen, so that a panel rendering it
 * does not import the component that owns the data, and so a second screen can use it without
 * reaching into the first screen's service.
 */
export interface PanelStatus {
  id: number | null;
  text: string;
  error: boolean;
}

/**
 * The reason the server gave, if it gave one. It answers with either `{"error": "..."}` or a bare
 * string depending on which layer refused, so both are read; anything else — an HTML page from a
 * proxy, a body that is not text, an empty one — is not a reason and is left to the caller's own
 * wording rather than shown to the visitor.
 */
export function serverReason(err: HttpErrorResponse): string | null {
  const body: unknown = err.error;

  const reason =
    typeof body === 'string'
      ? body
      : body !== null && typeof body === 'object' && 'error' in body
        ? (body as { error: unknown }).error
        : null;

  if (typeof reason !== 'string') return null;

  const trimmed = reason.trim();
  return trimmed === '' || trimmed.includes('<') ? null : trimmed;
}
