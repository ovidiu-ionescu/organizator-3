/**
 * @prettier
 *
 * The plumbing every frontend here uses to talk to the server: what a failed answer looks like,
 * what the server said went wrong, and where the reader goes when the session is gone.
 *
 * It is separate from server_comm.ts — which is the memo app's own calls — because that file drags
 * the memo database and the editor along with it, and the calendar needs the same conventions
 * without any of that. server_comm re-exports the two error classes from here rather than declaring
 * its own, so that `instanceof server_comm.HttpError` keeps answering true for the callers and
 * specs that reach for them either way.
 */
import konsole from "./console_log.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(`HTTP Error ${status}: ${message}`);
    this.name = 'HttpError';
  }
}

export class UnauthenticatedError extends HttpError {
  constructor(message: string = `No session, need to log in`) {
    super(401, message);
    this.name = 'UnauthenticatedError';
  }
}

/// The page the reader is sent to when the session is gone. Same shape as everywhere else: back
/// here once they have signed in again.
export const go_to_login = (): void =>
  window.location.replace(`/login.html?r=${encodeURIComponent(window.location.href)}`);

/// What went wrong, for a reader rather than a log. Not everything thrown here is an Error:
/// read_memo throws a plain object with a message on it.
export const describe_failure = (e: unknown): string => {
  if (e instanceof Error) {
    return e.message;
  }
  if (typeof e === "object" && e !== null && "message" in e) {
    return String((e as { message: unknown }).message);
  }
  return String(e);
};

/**
 * What the server said went wrong, when it said anything worth repeating.
 *
 * The backend answers a refusal either with a bare string or with `{error: …}`; both are read here.
 * Anything else is not something to put in front of a reader — a body holding markup is a proxy's
 * page or a login form, not a reason — so it answers null and the caller uses its own words.
 */
export const server_reason = async (response: Response): Promise<string | null> => {
  let body: string;
  try {
    body = await response.text();
  } catch (e) {
    konsole.log("Could not read the refusal's body", e);
    return null;
  }

  const text = body.trim();
  if (text === "" || text.includes("<")) return null;

  if (text.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
        const error = (parsed as { error: unknown }).error;
        return typeof error === "string" && error !== "" ? error : null;
      }
    } catch {
      // Not JSON after all. The body as it stands is still the server's own words.
    }
  }

  return text;
};
