// csv-reader-speed: a faster drop-in for make.fun's csv-reader 1.0.0.
// run(input) returns exactly csv-reader 1.0.0's answer {columns, rows, errors}
// for every input {text, header}. Written from the reference semantics
// (csv-reader 1.0.0's own index.js), not from any other parser.
//
// Speed comes from jumping between delimiters with indexOf (native) and
// slicing fields out of the original string instead of building them a
// character at a time. A whole record with no quote and no stray CR is one
// native split; only lines holding a quote or a stray CR fall back to a
// field-by-field scan, which still jumps with indexOf. The field readers
// write into shared slots instead of returning a fresh object per field,
// so a set's ~1M fields cost no per-field allocation.

/** How a field ended: at a comma (the record goes on), at a line break or at the end of the text (the record ends). */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;
/** A CR, handled where it is met: a CRLF ends the record, a lone CR is dropped (stray_cr). */
const CR = 3;

/** The next field delimiter: a comma, a CR or an LF (one native scan, used by readUnquoted). */
const DELIM = /[,\r\n]/g;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The field just read: its value, how it ended, and how many characters were kept onto it.
  let fValue = '';
  let fEnded = END;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not followed by LF is dropped
  // (stray_cr). Sets fValue, fEnded, fAdded.
  function readUnquoted(value) {
    let added = 0;
    while (true) {
      if (pos >= len) {
        fValue = value;
        fEnded = END;
        fAdded = added;
        return;
      }
      DELIM.lastIndex = pos;
      const m = DELIM.exec(text);
      if (m === null) {
        value += text.slice(pos);
        added += len - pos;
        pos = len;
        fValue = value;
        fEnded = END;
        fAdded = added;
        return;
      }
      const end = m.index;
      const c = text.charCodeAt(end);
      if (c === 13) { // '\r'
        if (text.charCodeAt(end + 1) === 10) {
          value += text.slice(pos, end);
          added += end - pos;
          pos = end + 2;
          line += 1;
          fValue = value;
          fEnded = LINE_BREAK;
          fAdded = added;
          return;
        }
        // A lone CR is dropped (stray_cr); the field goes on.
        value += text.slice(pos, end);
        added += end - pos;
        error('stray_cr');
        pos = end + 1;
        continue;
      }
      value += text.slice(pos, end);
      added += end - pos;
      if (c === 44) { // ','
        pos = end + 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = added;
        return;
      }
      pos = end + 1; // '\n'
      line += 1;
      fValue = value;
      fEnded = LINE_BREAK;
      fAdded = added;
      return;
    }
  }

  // Reads a quoted field whose opening quote is at pos. Sets fValue, fEnded, fAdded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    const parts = [];
    let segStart = pos;
    while (true) {
      const q = text.indexOf('"', pos);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
        line = openLine;
        error('unterminated_quote');
        pos = open + 1;
        readUnquoted('"');
        return;
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one literal quote.
        parts.push(text.slice(segStart, q));
        parts.push('"');
        pos = q + 2;
        segStart = pos;
        continue;
      }
      // The closing quote.
      parts.push(text.slice(segStart, q));
      let value = parts.length === 1 ? parts[0] : parts.join('');
      // Each CRLF or lone CR inside quotes is one LF.
      if (value.indexOf('\r') !== -1) value = value.replace(/\r\n?/g, '\n');
      // Each line break inside the quotes is one line.
      if (value.indexOf('\n') !== -1) {
        let n = 0;
        let i = -1;
        while ((i = value.indexOf('\n', i + 1)) !== -1) n += 1;
        line += n;
      }
      pos = q + 1;
      if (pos >= len) {
        fValue = value;
        fEnded = END;
        fAdded = 0;
        return;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        pos += 1;
        fValue = value;
        fEnded = COMMA;
        fAdded = 0;
        return;
      }
      if (c === 10) { // '\n'
        pos += 1;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { // '\r\n'
        pos += 2;
        line += 1;
        fValue = value;
        fEnded = LINE_BREAK;
        fAdded = 0;
        return;
      }
      // What follows the closing quote is appended as it stands, up to the next comma or line break.
      readUnquoted(value);
      if (fAdded > 0) error('quote_junk');
      return;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      if (text.charCodeAt(pos) === 10) {
        pos += 1;
        line += 1;
      } else if (text.charCodeAt(pos) === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: a whole record with no quote and no stray CR is one native split.
    const nl = text.indexOf('\n', pos);
    const lineEnd = nl === -1 ? len : nl;
    let seg = text.slice(pos, lineEnd);
    if (seg.indexOf('"') === -1) {
      let ok = true;
      const cr = seg.indexOf('\r');
      if (cr !== -1) {
        // A trailing CR at the end of the text is a stray CR, not a record end.
        if (nl === -1 || cr !== seg.length - 1) ok = false;
        else seg = seg.slice(0, -1); // the CR of a CRLF record end
      }
      if (ok && seg !== '') {
        const fields = seg.split(',');
        pos = nl === -1 ? len : nl + 1;
        if (nl !== -1) line += 1;
        if (width < 0) width = fields.length;
        if (header && columns === null) {
          columns = fields;
        } else {
          if (fields.length < width) {
            errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
            while (fields.length < width) fields.push('');
          } else if (fields.length > width) {
            errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
          }
          rows.push(fields);
        }
        continue;
      }
      if (ok) {
        // An empty line (only the CR of a CRLF was left): no record.
        pos = nl === -1 ? len : nl + 1;
        if (nl !== -1) line += 1;
        continue;
      }
    }

    // A line holding a quote or a stray CR: read it field by field.
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
