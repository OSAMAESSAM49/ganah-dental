/**
 * Tiny Markdown reader for the in-app guides (docs/guides/*.md): headings, paragraphs,
 * nested lists, quotes, **bold**, `code` and links. Everything is escaped first, so only
 * the markup made here reaches the page.
 */
import { escapeHTML } from './dom.js';

/** Inline: links, bold, code. Input is already escaped. */
function inline(text) {
  return text
    .replace(/&#96;(.+?)&#96;/g, '<code>$1</code>') // backticks arrive escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

/** @param {string} md @returns {string} HTML */
export function markdownToHTML(md) {
  const out = [];
  /** open lists: { indent, tag } */
  const lists = [];
  let para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const closeLists = (toIndent = -1) => {
    while (lists.length && lists.at(-1).indent > toIndent) out.push(`</li></${lists.pop().tag}>`);
  };

  for (const rawLine of String(md).replace(/\r/g, '').split('\n')) {
    const line = escapeHTML(rawLine);
    const item = /^(\s*)([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (!line.trim()) { flushPara(); continue; }
    if (item) {
      flushPara();
      const indent = item[1].length;
      const tag = /\d/.test(item[2]) ? 'ol' : 'ul';
      closeLists(indent);
      const top = lists.at(-1);
      if (top && top.indent === indent && top.tag === tag) out.push('</li><li>');
      else {
        if (top && top.indent === indent) out.push(`</li></${lists.pop().tag}>`);
        out.push(`<${tag}><li>`);
        lists.push({ indent, tag });
      }
      out.push(inline(item[3]));
      continue;
    }
    if (lists.length && /^\s+\S/.test(line)) { out.push(' ' + inline(line.trim())); continue; } // continuation
    closeLists();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) { flushPara(); const n = Math.min(4, heading[1].length + 1); out.push(`<h${n}>${inline(heading[2])}</h${n}>`); continue; }
    const quote = /^&gt;\s?(.*)$/.exec(line);
    if (quote) { flushPara(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    para.push(line.trim());
  }
  flushPara();
  closeLists();
  return out.join('\n');
}
