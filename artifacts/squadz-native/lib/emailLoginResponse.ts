export type EmailLoginPayload = {
  token?: unknown;
  refreshToken?: unknown;
  user?: unknown;
  emailVerified?: unknown;
  phone?: unknown;
  error?: unknown;
};

export type EmailLoginResponseOutcome =
  | { kind: "success" }
  | { kind: "invalid-credentials"; error: string }
  | { kind: "malformed-success"; error: string }
  | { kind: "request-failure"; error: string };

const INVALID_CREDENTIALS = "Incorrect email or password.";
const INCOMPLETE_RESPONSE =
  "We couldn't complete sign in. Please try again.";

function hasUsableSession(payload: EmailLoginPayload): boolean {
  return (
    typeof payload.token === "string" &&
    payload.token.length > 0 &&
    typeof payload.user === "object" &&
    payload.user !== null &&
    typeof (payload.user as { id?: unknown }).id === "string" &&
    (payload.user as { id: string }).id.length > 0
  );
}

/**
 * Keep the message presented after email/password login truthful:
 * only an actual 401 is evidence of incorrect credentials. A successful HTTP
 * response without a usable session is an API contract failure, not user error.
 */
export function classifyEmailLoginResponse(
  status: number,
  payload: EmailLoginPayload,
): EmailLoginResponseOutcome {
  if (status === 401) {
    return { kind: "invalid-credentials", error: INVALID_CREDENTIALS };
  }

  if (status >= 200 && status < 300) {
    return hasUsableSession(payload)
      ? { kind: "success" }
      : { kind: "malformed-success", error: INCOMPLETE_RESPONSE };
  }

  if (status === 429) {
    return {
      kind: "request-failure",
      error: "Too many requests — please wait a moment and try again.",
    };
  }
  if (status >= 500) {
    return {
      kind: "request-failure",
      error: "Sign in is temporarily unavailable. Please try again shortly.",
    };
  }
  return { kind: "request-failure", error: INCOMPLETE_RESPONSE };
}