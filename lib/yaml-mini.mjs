/**
 * lib/yaml-mini.mjs — Minimal YAML parser for the subset faber config files use.
 *
 * Handles:
 *   - Nested objects via indentation (2-space steps)
 *   - Lists with `- value` syntax
 *   - Empty lists `[]`, empty objects `{}`
 *   - Scalars: bool, int, float, null/~, single-quoted, double-quoted, bare
 *   - Inline comments after `#` (only when not inside a quoted string)
 *
 * Does NOT handle:
 *   - Multi-line strings (>, |)
 *   - Anchors / aliases (&, *)
 *   - Flow-style nested maps ({a: 1, b: 2}) — only flow-style empty-collections
 *   - Tags (!!type)
 *
 * Use it for config/profile.yml location_filter, portals.yml extensions,
 * etc. For arbitrary user YAML, use a real library.
 */

/**
 * Parse a YAML document string into a JS object.
 * @param {string} text
 * @returns {object}
 */
export function parseYaml(text) {
  if (!text || typeof text !== 'string') return {};
  const lines = text.split('\n').map((line) => {
    // Strip line-end comments only if # is not inside quotes
    return stripInlineComment(line.replace(/\r$/, ''));
  });
  return parseBlock(lines, 0, 0).result;
}

/**
 * Extract a top-level block by key name and return its parsed value.
 * Returns undefined if the key is not present at column 0.
 * Useful when you only need one section of a larger YAML file.
 */
export function extractBlock(text, key) {
  const parsed = parseYaml(text);
  return parsed[key];
}

// ---------------------------------------------------------------------------
// Internal: line-based recursive descent
// ---------------------------------------------------------------------------

function parseBlock(lines, startIdx, indent) {
  // Detect whether this block is a list (- ...) or a mapping (key: ...)
  let i = startIdx;
  while (i < lines.length && isBlankOrComment(lines[i])) i++;
  if (i >= lines.length) return { result: {}, nextIdx: i };

  const firstContent = lines[i];
  const firstIndent = leadingSpaces(firstContent);
  if (firstIndent < indent) return { result: {}, nextIdx: startIdx };

  const trimmed = firstContent.trim();
  if (trimmed.startsWith('- ') || trimmed === '-') {
    return parseListBlock(lines, startIdx, firstIndent);
  }
  return parseMapBlock(lines, startIdx, firstIndent);
}

function parseMapBlock(lines, startIdx, indent) {
  const result = {};
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankOrComment(line)) {
      i++;
      continue;
    }
    const lineIndent = leadingSpaces(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      // Continuation of a previous key whose block we already consumed via recursion.
      // If we ever reach here the parser is misaligned; advance and continue defensively.
      i++;
      continue;
    }

    const trimmed = line.trim();
    const kv = trimmed.match(/^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^:#]+):\s*(.*)$/);
    if (!kv) {
      i++;
      continue;
    }
    const key = unquote(kv[1].trim());
    const rest = kv[2].trim();

    if (rest === '' || rest === '|' || rest === '>') {
      // Nested block. Look ahead.
      const childIdx = findNextContent(lines, i + 1);
      if (childIdx >= lines.length || leadingSpaces(lines[childIdx]) <= lineIndent) {
        // No children → empty value
        result[key] = null;
        i++;
      } else {
        const child = parseBlock(lines, i + 1, leadingSpaces(lines[childIdx]));
        result[key] = child.result;
        i = child.nextIdx;
      }
    } else if (rest === '[]') {
      result[key] = [];
      i++;
    } else if (rest === '{}') {
      result[key] = {};
      i++;
    } else {
      result[key] = parseScalar(rest);
      i++;
    }
  }
  return { result, nextIdx: i };
}

function parseListBlock(lines, startIdx, indent) {
  const result = [];
  let i = startIdx;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlankOrComment(line)) {
      i++;
      continue;
    }
    const lineIndent = leadingSpaces(line);
    if (lineIndent < indent) break;
    if (lineIndent > indent) {
      i++;
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith('-')) break;

    const after = trimmed.slice(1).trim();
    if (after === '') {
      // Nested block under the list item
      const childIdx = findNextContent(lines, i + 1);
      if (childIdx >= lines.length || leadingSpaces(lines[childIdx]) <= lineIndent) {
        result.push(null);
        i++;
      } else {
        const child = parseBlock(lines, i + 1, leadingSpaces(lines[childIdx]));
        result.push(child.result);
        i = child.nextIdx;
      }
    } else if (after.includes(':') && !after.startsWith('"') && !after.startsWith("'")) {
      // Inline mapping: "- key: value"
      const inlineKv = after.match(/^([^:]+):\s*(.*)$/);
      if (inlineKv) {
        const obj = {};
        obj[unquote(inlineKv[1].trim())] = parseScalar(inlineKv[2].trim());
        // Continue collecting indented siblings as part of the same map
        let j = i + 1;
        const childIndent = lineIndent + 2;
        while (j < lines.length) {
          if (isBlankOrComment(lines[j])) {
            j++;
            continue;
          }
          if (leadingSpaces(lines[j]) < childIndent) break;
          const sub = parseBlock(lines, j, childIndent);
          Object.assign(obj, sub.result);
          j = sub.nextIdx;
          break;
        }
        result.push(obj);
        i = j;
      } else {
        result.push(parseScalar(after));
        i++;
      }
    } else {
      result.push(parseScalar(after));
      i++;
    }
  }
  return { result, nextIdx: i };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function leadingSpaces(line) {
  const m = line.match(/^( *)/);
  return m ? m[1].length : 0;
}

function isBlankOrComment(line) {
  const t = line.trim();
  return t === '' || t.startsWith('#');
}

function findNextContent(lines, fromIdx) {
  let i = fromIdx;
  while (i < lines.length && isBlankOrComment(lines[i])) i++;
  return i;
}

function stripInlineComment(line) {
  // Remove ` #...` to end of line, but only when # is preceded by whitespace
  // and not inside quotes. Cheap heuristic: track whether we're inside quotes.
  let inSingle = false;
  let inDouble = false;
  let prev = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && prev !== '\\' && !inSingle) inDouble = !inDouble;
    else if (c === "'" && prev !== '\\' && !inDouble) inSingle = !inSingle;
    else if (c === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).replace(/\s+$/, '');
    }
    prev = c;
  }
  return line;
}

function unquote(s) {
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function parseScalar(s) {
  const t = s.trim();
  if (t === '') return null;
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1);
  }
  if (t === 'true' || t === 'True' || t === 'TRUE') return true;
  if (t === 'false' || t === 'False' || t === 'FALSE') return false;
  if (t === 'null' || t === 'Null' || t === 'NULL' || t === '~') return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^-?\d+\.\d+$/.test(t)) return parseFloat(t);
  return t;
}

// ---------------------------------------------------------------------------
// Validation block
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const cases = [
    {
      name: 'flat map',
      input: `name: alex\nage: 30\nactive: true\n`,
      expect: { name: 'alex', age: 30, active: true },
    },
    {
      name: 'nested map',
      input: `outer:\n  inner: value\n  flag: false\nother: 1\n`,
      expect: { outer: { inner: 'value', flag: false }, other: 1 },
    },
    {
      name: 'list of strings',
      input: `items:\n  - "first"\n  - second\n  - "third"\n`,
      expect: { items: ['first', 'second', 'third'] },
    },
    {
      name: 'empty list',
      input: `things: []\nname: foo\n`,
      expect: { things: [], name: 'foo' },
    },
    {
      name: 'comments stripped',
      input: `# top comment\nname: alex  # inline\nage: 30\n`,
      expect: { name: 'alex', age: 30 },
    },
    {
      name: 'location_filter shape',
      input: `location_filter:
  enabled: true
  remote:
    enabled: true
    accept_regions:
      - "us"
      - "americas"
    bare_remote_policy: "allow"
  hybrid:
    locations:
      - "NYC"
      - "NJ"
  onsite:
    locations: []
  unknown_policy: "ask"
candidate:
  full_name: "Jane"
`,
      expect: {
        location_filter: {
          enabled: true,
          remote: {
            enabled: true,
            accept_regions: ['us', 'americas'],
            bare_remote_policy: 'allow',
          },
          hybrid: { locations: ['NYC', 'NJ'] },
          onsite: { locations: [] },
          unknown_policy: 'ask',
        },
        candidate: { full_name: 'Jane' },
      },
    },
    {
      name: 'extractBlock returns one section',
      input: `location_filter:\n  enabled: true\n  hybrid:\n    locations:\n      - "NYC"\nother: foo\n`,
      expectExtract: 'location_filter',
      expect: {
        enabled: true,
        hybrid: { locations: ['NYC'] },
      },
    },
    {
      name: 'comment with hash inside string preserved',
      input: `password: "abc#def"\nplain: foo\n`,
      expect: { password: 'abc#def', plain: 'foo' },
    },
  ];

  let failures = 0;
  for (const c of cases) {
    const got = c.expectExtract ? extractBlock(c.input, c.expectExtract) : parseYaml(c.input);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures++;
      console.error(`✗ ${c.name}`);
      console.error(`     expected: ${JSON.stringify(c.expect)}`);
      console.error(`     got:      ${JSON.stringify(got)}`);
    }
  }
  if (failures > 0) {
    console.error(`\n❌ ${failures} of ${cases.length} tests failed`);
    process.exit(1);
  }
  console.log(`✅ All ${cases.length} yaml-mini tests passed`);
}
