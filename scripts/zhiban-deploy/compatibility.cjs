'use strict';
/** PG16->18 comparison rules only. Never substituted for frozen provider fingerprints. */
function tokens(text) {
  const out = [];
  let at = 0;
  while (at < text.length) {
    const tail = text.slice(at),
      m =
        /^(?:\s+|'(?:''|[^'])*'|"(?:""|[^"])*"|[A-Za-z_][A-Za-z_0-9$]*|\d+(?:\.\d+)?|::|<=|>=|<>|!=|!~|[\s\S])/.exec(
          tail,
        );
    const token = m[0];
    at += token.length;
    if (!/^\s+$/.test(token)) out.push(token);
  }
  return out;
}
function expression(t) {
  const balancedOuter = () => {
    if (t[0] !== '(' || t.at(-1) !== ')') return false;
    let depth = 0;
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      if (t[i] === ')') depth--;
      if (depth === 0 && i < t.length - 1) return false;
    }
    return depth === 0;
  };
  while (balancedOuter()) t = t.slice(1, -1);
  // Preserve all atoms, strings and arithmetic. Only associative Boolean groups
  // emitted differently by pg_get_constraintdef may be flattened.
  for (const op of ['OR', 'AND']) {
    let depth = 0,
      start = 0;
    const parts = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++;
      else if (t[i] === ')') depth--;
      else if (depth === 0 && t[i] === op) {
        parts.push(t.slice(start, i));
        start = i + 1;
      }
    }
    if (parts.length) {
      parts.push(t.slice(start));
      const children = parts.map(expression);
      return [op, ...children.flatMap((x) => (x[0] === op ? x.slice(1) : [x]))];
    }
  }
  return ['ATOM', ...t];
}
function checkDefinition(def) {
  const t = tokens(def);
  return t[0] === 'CHECK' ? ['CHECK', expression(t.slice(1))] : ['EXACT', def];
}
function comparable(input) {
  const copy = structuredClone(input),
    introduced = {};
  for (const [db, body] of Object.entries(copy.databases)) {
    const owners = new Map(body.catalog.tables.map((t) => [JSON.stringify(t.slice(0, 2)), t[2]]));
    let removed = 0;
    body.catalog.acl = body.catalog.acl.filter((a) => {
      const owner = owners.get(JSON.stringify(a.slice(1, 3)));
      const knownOwnerPrivilege =
        a[0] === 'table' &&
        a[5] === 'MAINTAIN' &&
        a[3] === owner &&
        a[4] === owner &&
        a[6] === false;
      if (knownOwnerPrivilege) removed++;
      return !knownOwnerPrivilege;
    });
    body.catalog.constraints = body.catalog.constraints.map((c) =>
      c[3] === 'c' ? [...c.slice(0, 4), checkDefinition(c[4]), ...c.slice(5)] : c,
    );
    introduced[db] = { ownerOnlyMaintain: removed };
  }
  return { facts: copy, introduced };
}
module.exports = { checkDefinition, comparable };
