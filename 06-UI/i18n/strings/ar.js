/**
 * Arabic dictionary — empty placeholder (Språkstöd 2026-09-21).
 *
 * Empty by design: strings fall back to en → sv → key-echo. The locale is
 * exposed in the Profile picker now so Stockholm-resident Arabic speakers
 * can lock their preference; translator can fill keys in over time without
 * blocking the app on a complete vocabulary.
 *
 * No RTL layout work ships with this file. Text within strings will render
 * RTL per Unicode bidi rules; the surrounding UI layout (LTR) is unchanged.
 */
export default {};
