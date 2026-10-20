// ---------------------------------------------------------------------------
// Internals that must not appear as readable text in the shipped bundle.
//
// Third-party hostnames, extractor ids and the embed's postMessage event names
// are stored base64-encoded here, so the built JavaScript that visitors can
// download never contains them as plain text (view-source, page-source greps,
// SEO crawlers and SEO text extraction).
//
// This is obfuscation, not encryption. It stops the names from showing up in
// the shipped source text. It does NOT hide them from someone who opens
// DevTools: the live iframe URL is visible in the DOM and the Network tab by
// definition. Decoding the values below is also trivial for anyone who tries.
// ---------------------------------------------------------------------------

const d = (b64) => atob(b64);

// --- embed host (Coco II / Coco III live here) -------------------------------
export const EMBED_HOST = d('ZnJhbWV4dHYueHl6');
export const EMBED_ORIGIN = `https://${EMBED_HOST}`;

// --- catalog API mirrors -----------------------------------------------------
export const API_MIRRORS = [
  d('YXBpLmZyYW1leHR2LnRlY2g='),
  d('YXBpLmZyYW1leHR2Lnh5eg=='),
  d('YXBpLmZyYW1leHR2LmNj'),
].map((host) => `https://${host}`);

// --- Coco I host -------------------------------------------------------------
export const VIDSRC_HOST = d('dmlkc3JjLm1l');

// --- real extractor ids sent as ?server= (never shown to users) --------------
export const PROVIDER_SECOND = d('dmFsa3lyaWU='); // Coco II
export const PROVIDER_THIRD = d('c3VwZXJfYmFyYmFyaWFu'); // Coco III

// --- postMessage event names the embed emits ---------------------------------
export const EVENTS = {
  ready: d('ZnJhbWVYVFY6cmVhZHk='),
  timeupdate: d('ZnJhbWVYVFY6dGltZXVwZGF0ZQ=='),
  ended: d('ZnJhbWVYVFY6ZW5kZWQ='),
};
