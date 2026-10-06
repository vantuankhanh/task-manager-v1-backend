// Reverse of escape-html, for values that go back to a client for display (name and email are stored escaped).
// &amp; is replaced last, so "&amp;lt;" comes back as "&lt;" and not as "<"
const unescapeHtml = (value) =>
  String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

module.exports = unescapeHtml;
