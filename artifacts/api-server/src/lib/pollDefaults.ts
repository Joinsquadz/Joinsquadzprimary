/**
 * Poll window defaults, kept out of storage.ts on purpose.
 *
 * Route tests mock the whole storage module, so a constant imported from there
 * would be undefined in every one of them. This lives in its own module so both
 * the routes (validating a trip length) and storage (filling in the window) can
 * read the same number without the mocks having to know about it.
 */

/**
 * How many dates a poll spans when the caller doesn't choose a window.
 *
 * This is a real window, not "no window": a trip length must be validated
 * against it even when the create request omits `days` entirely.
 */
export const DEFAULT_POLL_DAY_COUNT = 7;
