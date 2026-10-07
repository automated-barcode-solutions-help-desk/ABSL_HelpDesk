#!/usr/bin/env node
// Builds supabase/live_schema_check.sql from supabase/migrations.
//
// Replays every migration in order to work out what the database should
// contain now - the latest version of each function, policy and trigger,
// minus anything a later migration dropped - and writes a SQL script that
// compares the live database with that and lists only the differences.
//
// Re-run after adding a migration:  node scripts/build-live-check.js
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const outFile = path.join(root, "supabase", "live_schema_check.sql");

// Present on purpose only after a manual Vault step (see 0020's header).
const OPTIONAL_TRIGGERS = new Set(["public.notifications.trg_send_notifications"]);

// --- SQL splitting -------------------------------------------------------

// Splits a script into statements on top-level semicolons, dropping
// comments outside quotes and keeping dollar-quoted bodies verbatim.
function splitStatements(src) {
  const statements = [];
  let buf = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "-" && d === "-") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      buf += " ";
      continue;
    }
    if (c === "'") {
      const escapes = /[eE]$/.test(buf) && !/[A-Za-z0-9_][eE]$/.test(buf);
      let j = i + 1;
      while (j < src.length) {
        if (escapes && src[j] === "\\") { j += 2; continue; }
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j += 1;
      }
      buf += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      const end = src.indexOf('"', i + 1);
      buf += src.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (c === "$") {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i, i + 64));
      if (tag) {
        const end = src.indexOf(tag[0], i + tag[0].length);
        if (end === -1) throw new Error("Unterminated dollar quote " + tag[0]);
        buf += src.slice(i, end + tag[0].length);
        i = end + tag[0].length;
        continue;
      }
    }
    if (c === ";") {
      if (buf.trim()) statements.push(buf.trim());
      buf = "";
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  if (buf.trim()) statements.push(buf.trim());
  return statements;
}

// Text inside the parentheses that open at `open`.
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(open + 1, i), close: i };
    }
  }
  throw new Error("Unbalanced parentheses: " + text.slice(open, open + 80));
}

function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// --- Names ---------------------------------------------------------------

function ident(raw) {
  const t = raw.trim();
  return t.startsWith('"') ? t.slice(1, -1) : t.toLowerCase();
}

function qualified(raw) {
  const parts = raw.trim().split(".");
  return parts.length === 2
    ? { schema: ident(parts[0]), name: ident(parts[1]) }
    : { schema: "public", name: ident(parts[0]) };
}

const TYPE_ALIASES = { int: "integer", int4: "integer", int8: "bigint", bool: "boolean", timestamptz: "timestamp with time zone" };

// Identity argument types, as to_regprocedure() accepts them.
function argTypes(argList) {
  return splitTopLevel(argList)
    .map((arg) => arg.replace(/\s+default\s+[\s\S]*$/i, "").replace(/\s*=\s*[\s\S]*$/, "").trim())
    .filter(Boolean)
    .map((arg) => {
      let tokens = arg.split(/\s+/);
      if (/^(in|out|inout|variadic)$/i.test(tokens[0])) {
        if (/^out$/i.test(tokens[0])) return null;
        tokens = tokens.slice(1);
      }
      const type = (tokens.length >= 2 ? tokens.slice(1) : tokens).join(" ").toLowerCase();
      return TYPE_ALIASES[type] || type;
    })
    .filter(Boolean);
}

function fnKey(schema, name, types) {
  const normalized = types.map((t) => t.replace(/^public\./, ""));
  return schema + "." + name + "(" + normalized.join(", ") + ")";
}

// --- Replay --------------------------------------------------------------

const QUALIFIED = '((?:"[^"]+"|\\w+)(?:\\.(?:"[^"]+"|\\w+))?)';
const RE = {
  createFn: new RegExp("^create\\s+(?:or\\s+replace\\s+)?function\\s+" + QUALIFIED + "\\s*\\(", "i"),
  dropFn: new RegExp("^drop\\s+function\\s+(?:if\\s+exists\\s+)?" + QUALIFIED + "\\s*\\(", "i"),
  createPolicy: new RegExp('^create\\s+policy\\s+("[^"]+"|\\w+)\\s+on\\s+' + QUALIFIED, "i"),
  dropPolicy: new RegExp('^drop\\s+policy\\s+(?:if\\s+exists\\s+)?("[^"]+"|\\w+)\\s+on\\s+' + QUALIFIED, "i"),
  createTrigger: new RegExp('^create\\s+(?:or\\s+replace\\s+)?(?:constraint\\s+)?trigger\\s+("[^"]+"|\\w+)\\s+[\\s\\S]+?\\bon\\s+' + QUALIFIED, "i"),
  dropTrigger: new RegExp('^drop\\s+trigger\\s+(?:if\\s+exists\\s+)?("[^"]+"|\\w+)\\s+on\\s+' + QUALIFIED, "i"),
};

const functions = new Map();
const policies = new Map();
const triggers = new Map();

const files = fs.readdirSync(migrationsDir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();

for (const file of files) {
  const src = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  for (const stmt of splitStatements(src)) {
    let m;
    if ((m = RE.createFn.exec(stmt))) {
      const { schema, name } = qualified(m[1]);
      const args = balanced(stmt, m[0].length - 1);
      const types = argTypes(args.inner);
      const rest = stmt.slice(args.close + 1);
      const tag = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
      const bodyStart = tag.index + tag[0].length;
      const bodyEnd = rest.indexOf(tag[0], bodyStart);
      const body = rest.slice(bodyStart, bodyEnd);
      const attrs = rest.slice(0, tag.index) + " " + rest.slice(bodyEnd + tag[0].length);
      const vol = /\bimmutable\b/i.test(attrs) ? "i" : /\bstable\b/i.test(attrs) ? "s" : "v";
      const sp = /\bset\s+search_path\s*(?:=|\bto\b)\s*([^\n]*?)\s*(?=\b(?:as|language|security|stable|immutable|volatile|returns|set|strict|parallel|cost)\b|$)/i.exec(attrs);
      functions.set(fnKey(schema, name, types), {
        file,
        // Quoted so names that are also SQL keywords (current_role) parse.
        signature: '"' + schema + '"."' + name + '"(' + types.join(", ") + ")",
        bodyMd5: crypto.createHash("md5").update(body.replace(/[ \t\n\r\f\v]/g, ""), "utf8").digest("hex"),
        secdef: /\bsecurity\s+definer\b/i.test(attrs),
        volatility: vol,
        config: sp ? "search_path=" + sp[1].replace(/[\s'"]/g, "") : "",
        isTrigger: /\breturns\s+trigger\b/i.test(attrs),
      });
    } else if ((m = RE.dropFn.exec(stmt))) {
      const { schema, name } = qualified(m[1]);
      const args = balanced(stmt, m[0].length - 1);
      if (stmt.slice(args.close + 1).trim().startsWith(",")) throw new Error(file + ": multi-function DROP not handled: " + stmt.slice(0, 120));
      functions.delete(fnKey(schema, name, argTypes(args.inner)));
    } else if ((m = RE.createPolicy.exec(stmt))) {
      const { schema, name: table } = qualified(m[2]);
      const policy = ident(m[1]);
      policies.set(schema + "." + table + "." + policy, { file, schema, table, policy, nameToken: m[1], stmt });
    } else if ((m = RE.dropPolicy.exec(stmt))) {
      const { schema, name: table } = qualified(m[2]);
      policies.delete(schema + "." + table + "." + ident(m[1]));
    } else if ((m = RE.createTrigger.exec(stmt))) {
      const { schema, name: table } = qualified(m[2]);
      const trigger = ident(m[1]);
      const fn = /execute\s+(?:function|procedure)\s+((?:"[^"]+"|\w+)(?:\.(?:"[^"]+"|\w+))?)\s*\(/i.exec(stmt);
      triggers.set(schema + "." + table + "." + trigger, { file, schema, table, trigger, fn: qualified(fn[1]).name });
    } else if ((m = RE.dropTrigger.exec(stmt))) {
      const { schema, name: table } = qualified(m[2]);
      triggers.delete(schema + "." + table + "." + ident(m[1]));
    } else if (/^(alter\s+policy|drop\s+table|alter\s+function\s+\S+\s+rename)/i.test(stmt)) {
      throw new Error(file + ": statement type not handled by this checker: " + stmt.slice(0, 120));
    }
  }
}

// --- Output --------------------------------------------------------------

const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function dollar(text) {
  let tag = "$absl_q$";
  for (let n = 1; text.includes(tag); n += 1) tag = "$absl_q" + n + "$";
  return tag + text + tag;
}

const fnRows = [...functions.values()].map((f) =>
  "    (" + [lit(f.signature), lit(f.bodyMd5), f.secdef, lit(f.volatility), lit(f.config), lit(f.file)].join(", ") + ")"
);

const policyRows = [...policies.values()].map((p, i) => {
  const checkStmt = "CREATE POLICY " + '"__absl_check_' + (i + 1) + '"' + p.stmt.slice(p.stmt.indexOf(p.nameToken) + p.nameToken.length);
  return "    (" + [i + 1, lit(p.schema), lit(p.table), lit(p.policy), lit(p.file), dollar(checkStmt)].join(", ") + ")";
});

const triggerRows = [...triggers.values()].map((t) =>
  "    (" + [lit(t.schema), lit(t.table), lit(t.trigger), lit(t.fn), lit(t.file), OPTIONAL_TRIGGERS.has(t.schema + "." + t.table + "." + t.trigger)].join(", ") + ")"
);

const policySchemas = [...new Set([...policies.values()].map((p) => p.schema + "." + p.table))];

const sql = `-- =====================================================================
-- live_schema_check.sql - does the live database match the migrations?
--
-- GENERATED by scripts/build-live-check.js from supabase/migrations
-- (${files[0]} .. ${files[files.length - 1]}). Do not edit by hand.
--
-- Paste the whole file into the Supabase SQL Editor and Run. It changes
-- nothing: it reads the catalog, and the policy comparison creates copies
-- of the expected rules inside a block that is always rolled back.
--
-- The result lists ONLY differences, after one summary row:
--   function  differs     live body/settings are not the repo's latest
--   function  left over   an old version the migrations meant to drop
--   policy    differs / missing / left over
--   trigger   missing / left over / calls a different function
--   table     row security OFF
-- Expected: the summary row says 0 problems.
-- =====================================================================

DROP TABLE IF EXISTS pg_temp.absl_expected_function;
CREATE TEMP TABLE absl_expected_function (signature text, body_md5 text, secdef boolean, volatility "char", config text, source text);
INSERT INTO absl_expected_function VALUES
${fnRows.join(",\n")};

DROP TABLE IF EXISTS pg_temp.absl_expected_trigger;
CREATE TEMP TABLE absl_expected_trigger (schema_name text, table_name text, trigger_name text, function_name text, source text, optional boolean);
INSERT INTO absl_expected_trigger VALUES
${triggerRows.join(",\n")};

DROP TABLE IF EXISTS pg_temp.absl_expected_policy;
CREATE TEMP TABLE absl_expected_policy (n integer, schema_name text, table_name text, policy_name text, source text, check_sql text);
INSERT INTO absl_expected_policy VALUES
${policyRows.join(",\n")};

DROP TABLE IF EXISTS pg_temp.absl_finding;
CREATE TEMP TABLE absl_finding (area text, item text, finding text, source text, optional boolean DEFAULT false);


-- 1. Functions ---------------------------------------------------------
INSERT INTO absl_finding (area, item, finding, source)
SELECT 'function', replace(e.signature, '"', ''),
       CASE
         WHEN p.oid IS NULL THEN 'missing'
         ELSE 'differs from repo: ' || concat_ws(', ',
           CASE WHEN md5(regexp_replace(p.prosrc, '[ \\t\\n\\r\\f\\v]', '', 'g')) <> e.body_md5 THEN 'body' END,
           CASE WHEN p.prosecdef <> e.secdef THEN 'security definer' END,
           CASE WHEN p.provolatile <> e.volatility THEN 'volatility' END,
           CASE WHEN regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''), '[ ''"]', '', 'g') <> e.config THEN 'search_path' END)
       END,
       e.source
FROM absl_expected_function e
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(e.signature)
WHERE p.oid IS NULL
   OR md5(regexp_replace(p.prosrc, '[ \\t\\n\\r\\f\\v]', '', 'g')) <> e.body_md5
   OR p.prosecdef <> e.secdef
   OR p.provolatile <> e.volatility
   OR regexp_replace(coalesce(array_to_string(p.proconfig, ','), ''), '[ ''"]', '', 'g') <> e.config;

INSERT INTO absl_finding (area, item, finding, source)
SELECT 'function', p.oid::regprocedure::text, 'left over: not in the migrations (an old version)', ''
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  AND NOT EXISTS (SELECT 1 FROM absl_expected_function e WHERE to_regprocedure(e.signature) = p.oid);


-- Privileged functions a signed-out visitor can call. Only the helpers
-- that row security evaluates for every visitor should be here, and
-- they are excluded below.
INSERT INTO absl_finding (area, item, finding, source)
SELECT 'function', p.oid::regprocedure::text, 'callable without signing in', ''
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND p.prosecdef
  AND p.prorettype <> 'trigger'::regtype
  AND has_function_privilege('anon', p.oid, 'EXECUTE')
  AND p.proname NOT IN ('current_role', 'is_staff', 'is_admin', 'can_view_ticket', 'can_access_ticket_file')
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e');


-- 2. Triggers ----------------------------------------------------------
INSERT INTO absl_finding (area, item, finding, source, optional)
SELECT 'trigger', e.schema_name || '.' || e.table_name || ': ' || e.trigger_name,
       CASE WHEN t.oid IS NULL THEN CASE WHEN e.optional THEN 'not installed (optional - instant emails, see 0020)' ELSE 'missing' END
            ELSE 'calls ' || p.proname || '() instead of ' || e.function_name || '()' END,
       e.source, e.optional AND t.oid IS NULL
FROM absl_expected_trigger e
LEFT JOIN pg_namespace n ON n.nspname = e.schema_name
LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.table_name
LEFT JOIN pg_trigger t ON t.tgrelid = c.oid AND t.tgname = e.trigger_name AND NOT t.tgisinternal
LEFT JOIN pg_proc p ON p.oid = t.tgfoid
WHERE t.oid IS NULL OR p.proname <> e.function_name;

INSERT INTO absl_finding (area, item, finding, source)
SELECT 'trigger', n.nspname || '.' || c.relname || ': ' || t.tgname, 'left over: not in the migrations', ''
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND NOT EXISTS (SELECT 1 FROM absl_expected_trigger e
                  WHERE e.schema_name = n.nspname AND e.table_name = c.relname AND e.trigger_name = t.tgname);


-- 3. Row security switched on for every app table ----------------------
INSERT INTO absl_finding (area, item, finding, source)
SELECT 'table', 'public.' || c.relname, 'row security is OFF', ''
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity;


-- 4. Policies ----------------------------------------------------------
-- Left over: live rules on the same tables that the migrations don't define.
INSERT INTO absl_finding (area, item, finding, source)
SELECT 'policy', p.schemaname || '.' || p.tablename || ': ' || p.policyname, 'left over: not in the migrations', ''
FROM pg_policies p
WHERE (p.schemaname = 'public' OR (p.schemaname || '.' || p.tablename) IN (${policySchemas.map(lit).join(", ")}))
  AND NOT EXISTS (SELECT 1 FROM absl_expected_policy e
                  WHERE e.schema_name = p.schemaname AND e.table_name = p.tablename AND e.policy_name = p.policyname);

-- Differs / missing: create each expected rule under a temporary name,
-- compare how Postgres stored it with the live rule, then roll it all back.
DO $absl_check$
DECLARE
  r record;
  v_rows jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  BEGIN
    PERFORM set_config('lock_timeout', '5s', true);

    FOR r IN SELECT * FROM absl_expected_policy ORDER BY n LOOP
      BEGIN
        EXECUTE r.check_sql;
      EXCEPTION WHEN OTHERS THEN
        v_errors := v_errors || jsonb_build_object(
          'item', r.schema_name || '.' || r.table_name || ': ' || r.policy_name,
          'finding', 'could not compare: ' || SQLERRM,
          'source', r.source);
      END;
    END LOOP;

    SELECT coalesce(jsonb_agg(jsonb_build_object('item', x.item, 'finding', x.finding, 'source', x.source)), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT e.schema_name || '.' || e.table_name || ': ' || e.policy_name AS item,
             e.source,
             CASE WHEN live.policyname IS NULL THEN 'missing'
                  ELSE 'differs from repo: ' || concat_ws(', ',
                    CASE WHEN live.cmd IS DISTINCT FROM chk.cmd THEN 'command' END,
                    CASE WHEN live.roles IS DISTINCT FROM chk.roles THEN 'roles' END,
                    CASE WHEN live.permissive IS DISTINCT FROM chk.permissive THEN 'permissive' END,
                    CASE WHEN live.qual IS DISTINCT FROM chk.qual THEN 'USING' END,
                    CASE WHEN live.with_check IS DISTINCT FROM chk.with_check THEN 'WITH CHECK' END)
             END AS finding
      FROM absl_expected_policy e
      JOIN pg_policies chk
        ON chk.schemaname = e.schema_name AND chk.tablename = e.table_name
       AND chk.policyname = '__absl_check_' || e.n
      LEFT JOIN pg_policies live
        ON live.schemaname = e.schema_name AND live.tablename = e.table_name
       AND live.policyname = e.policy_name
      WHERE live.policyname IS NULL
         OR live.cmd IS DISTINCT FROM chk.cmd
         OR live.roles IS DISTINCT FROM chk.roles
         OR live.permissive IS DISTINCT FROM chk.permissive
         OR live.qual IS DISTINCT FROM chk.qual
         OR live.with_check IS DISTINCT FROM chk.with_check
    ) x;

    RAISE EXCEPTION 'absl_check_rollback';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'absl_check_rollback' THEN
      v_errors := v_errors || jsonb_build_object('item', 'policy comparison', 'finding', 'stopped: ' || SQLERRM, 'source', '');
    END IF;
  END;

  INSERT INTO absl_finding (area, item, finding, source)
  SELECT 'policy', j->>'item', j->>'finding', j->>'source'
  FROM jsonb_array_elements(v_rows || v_errors) AS j;
END
$absl_check$;


-- 5. Result ------------------------------------------------------------
SELECT area, item, finding, source
FROM (
  SELECT 0 AS ord, 'SUMMARY' AS area,
         (SELECT count(*) FROM absl_finding WHERE NOT optional) || ' problem(s)' AS item,
         'checked ${functions.size} functions, ${policies.size} policies, ${triggers.size} triggers, row security on every table' AS finding,
         '' AS source
  UNION ALL
  SELECT 1, area, item, finding, source FROM absl_finding
) r
ORDER BY ord, area, item;
`;

fs.writeFileSync(outFile, sql);
console.log("Wrote " + path.relative(root, outFile) + ": " + functions.size + " functions, " + policies.size + " policies, " + triggers.size + " triggers (" + files.length + " migrations).");
