/**
 * Who the server thinks is calling.
 *
 * The smallest possible statement of the rule this whole issue is about: the
 * answer comes from `getSessionUser()`, which validated a token against the
 * auth server, and from nothing else. There is no parameter this handler reads.
 * Passing `?user_id=…` changes nothing about the response, which is the
 * property `tests/integration/session-scoping.test.ts` pins.
 *
 * Returns `{ user: null }` rather than a 401 for an anonymous caller: "is
 * anybody signed in?" is a question the sign-in page itself asks, and an error
 * status for the ordinary negative answer would make every caller catch.
 */

export default defineEventHandler(async (event) => {
  const user = await getSessionUser(event)

  // A session's existence is not sensitive, but its token is: nothing about
  // the access or refresh token is echoed here, deliberately.
  return { user }
})
