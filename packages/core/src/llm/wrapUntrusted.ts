const CLOSING_TAG_RE = /<\s*\/\s*untrusted_document\b[^>]*>/gi;

/** Escape a value used inside a double-quoted XML attribute. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Neutralise any embedded `</untrusted_document…>` so untrusted text cannot
 * close the wrapper early (SPEC §11 / project.mdc: JD + pages are data).
 */
export function neutralizeUntrustedClosingTags(text: string): string {
  return text.replace(CLOSING_TAG_RE, (match) =>
    match.replace(/^</, "<\u200B"),
  );
}

/**
 * Wrap untrusted content for the model. Closing tags inside `text` are mangled
 * so they cannot terminate the document element.
 */
export function wrapUntrusted(source: string, text: string): string {
  const safeSource = escapeAttr(source);
  const safeText = neutralizeUntrustedClosingTags(text);
  return `<untrusted_document source="${safeSource}">\n${safeText}\n</untrusted_document>`;
}
