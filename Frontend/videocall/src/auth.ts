/**
 * The identity service owns the session: the same HttpOnly `__Host-jwt` cookie the memo app
 * uses, sent automatically on this origin. The app asks `/organizator/me` who it is before it
 * shows anything, and sends the reader to the login page when there is no session.
 */

export type MeResult =
  | { kind: "ok"; name: string }
  | { kind: "unauthenticated" }
  | { kind: "error"; message: string };

const is_object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export async function fetch_me(): Promise<MeResult> {
  try {
    const response = await fetch("/organizator/me", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401 || response.status === 403) {
      return { kind: "unauthenticated" };
    }
    if (!response.ok) {
      return {
        kind: "error",
        message: `The identity service answered ${response.status}.`,
      };
    }

    const body: unknown = await response.json();
    if (!is_object(body) || typeof body.name !== "string") {
      return {
        kind: "error",
        message: "The identity service sent an answer this page does not understand.",
      };
    }
    return { kind: "ok", name: body.name };
  } catch {
    return { kind: "error", message: "Could not reach the identity service." };
  }
}

/** Back here once the reader has signed in, the same way the memo app does it. */
export function go_to_login(): void {
  window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);
}
