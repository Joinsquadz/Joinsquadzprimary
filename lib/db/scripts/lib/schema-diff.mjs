/**
 * Schema introspection and snapshot diffing for migration validation.
 *
 * Split out from `validate-migrations.mjs` so the diff logic can be exercised
 * directly by tests that inject a known drift and assert it is caught. A drift
 * checker nobody tests is just a comment that takes time to run.
 *
 * Every query is scoped to a single schema. Nothing here assumes "public", and
 * nothing here reads a catalog entry it has not filtered by that schema — an
 * unqualified catalog lookup was previously able to match objects in an
 * unrelated schema and produce a wrong answer.
 */
import fs from "node:fs";
import path from "node:path";

/** Snapshot type → the type Postgres will actually report back. */
export function expectedPgType(snapshotType) {
  const t = snapshotType.toLowerCase();
  if (t === "serial") return "integer";
  if (t === "bigserial") return "bigint";
  if (t === "varchar") return "character varying";
  if (t.startsWith("varchar(")) return t.replace("varchar", "character varying");
  // Drizzle writes the bare SQL spelling; Postgres reports the canonical name.
  if (t === "timestamp") return "timestamp without time zone";
  if (t === "timestamptz") return "timestamp with time zone";
  if (t === "time") return "time without time zone";
  return t;
}

/**
 * Defaults are spelled differently on each side ("False" vs "false", implicit
 * casts, quoting), so compare a normalized form. This still catches a default
 * that is missing, added, or changed to a different value — the drift that
 * matters — without failing on cosmetic rendering differences.
 */
export function normalizeDefault(value) {
  if (value === undefined || value === null) return null;
  let s = String(value).trim();
  if (s === "true" || s === "True") return "true";
  if (s === "false" || s === "False") return "false";
  s = s.replace(/::[a-zA-Z_ ]+(\[\])?/g, ""); // drop casts
  s = s.replace(/\s+/g, "").toLowerCase();
  return s;
}

const colKey = (cols) => [...cols].sort().join(",");

const DELETE_RULE = {
  a: "no action",
  r: "restrict",
  c: "cascade",
  n: "set null",
  d: "set default",
};

/** Read every table, column, constraint and index in one schema. */
export async function introspectSchema(client, schema) {
  const { rows: columnRows } = await client.query(
    `SELECT c.relname AS table_name,
            a.attname AS column_name,
            format_type(a.atttypid, a.atttypmod) AS data_type,
            a.attnotnull AS not_null,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE n.nspname = $1 AND c.relkind = 'r'`,
    [schema],
  );

  const { rows: constraintRows } = await client.query(
    `SELECT con.conname AS name,
            rel.relname AS table_name,
            con.contype AS type,
            ref.relname AS ref_table,
            con.confdeltype AS delete_rule,
            ARRAY(SELECT a.attname FROM unnest(con.conkey) k
                    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k
                  )::text[] AS columns
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
       LEFT JOIN pg_class ref ON ref.oid = con.confrelid
      WHERE n.nspname = $1 AND rel.relkind = 'r'`,
    [schema],
  );

  const { rows: indexRows } = await client.query(
    `SELECT i.relname AS name,
            t.relname AS table_name,
            ix.indisunique AS is_unique,
            ix.indisprimary AS is_primary,
            con.conname AS backing_constraint,
            ARRAY(SELECT pg_get_indexdef(ix.indexrelid, k + 1, true)
                    FROM generate_subscripts(ix.indkey, 1) AS k
                   ORDER BY k)::text[] AS columns
       FROM pg_index ix
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN pg_class t ON t.oid = ix.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid AND con.conrelid = ix.indrelid
      WHERE n.nspname = $1 AND t.relkind = 'r'`,
    [schema],
  );

  const columns = new Map();
  for (const row of columnRows) {
    if (!columns.has(row.table_name)) columns.set(row.table_name, new Map());
    columns.get(row.table_name).set(row.column_name, row);
  }

  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.table_name)) map.set(row.table_name, []);
      map.get(row.table_name).push(row);
    }
    return map;
  };

  return {
    columns,
    constraints: group(constraintRows),
    indexes: group(indexRows),
  };
}

/**
 * Diff an introspected schema against a Drizzle snapshot.
 *
 * Symmetric by design: every class of object is checked in BOTH directions, so
 * an object the migrations create that the snapshot does not declare is a
 * failure just like a missing one. One-directional checking is how the previous
 * validator passed while two indexes and two foreign keys were out of sync.
 *
 * @returns {string[]} problems; empty means the schemas agree.
 */
export function diffAgainstSnapshot(built, snapshot) {
  const problems = [];
  const fail = (kind, detail) => problems.push(`${kind}: ${detail}`);

  const snapshotTableNames = new Set();

  for (const [key, table] of Object.entries(snapshot.tables)) {
    const name = key.replace(/^public\./, "");
    snapshotTableNames.add(name);

    const liveColumns = built.columns.get(name);
    if (!liveColumns) {
      fail("MISSING TABLE", name);
      continue;
    }

    // --- columns: presence, type, nullability, default ---
    for (const [columnName, column] of Object.entries(table.columns)) {
      const live = liveColumns.get(columnName);
      if (!live) {
        fail("MISSING COLUMN", `${name}.${columnName}`);
        continue;
      }
      const wantType = expectedPgType(column.type);
      if (live.data_type !== wantType) {
        fail("COLUMN TYPE", `${name}.${columnName} — snapshot ${wantType}, built ${live.data_type}`);
      }
      const wantNotNull = !!column.notNull || !!column.primaryKey;
      if (wantNotNull !== live.not_null) {
        fail(
          "COLUMN NULLABILITY",
          `${name}.${columnName} — snapshot ${wantNotNull ? "NOT NULL" : "nullable"}, built ${live.not_null ? "NOT NULL" : "nullable"}`,
        );
      }
      const wantDefault = normalizeDefault(column.default);
      const liveDefault = normalizeDefault(live.default_expr);
      const serialDefaulted =
        /^(big)?serial$/i.test(column.type) && (live.default_expr ?? "").startsWith("nextval(");
      if (!serialDefaulted && wantDefault !== liveDefault) {
        fail(
          "COLUMN DEFAULT",
          `${name}.${columnName} — snapshot ${wantDefault ?? "none"}, built ${liveDefault ?? "none"}`,
        );
      }
    }

    for (const columnName of liveColumns.keys()) {
      if (!table.columns[columnName]) fail("UNEXPECTED COLUMN", `${name}.${columnName}`);
    }

    const tableConstraints = built.constraints.get(name) ?? [];
    const tableIndexes = built.indexes.get(name) ?? [];

    // --- primary key (single-column flags or a composite declaration) ---
    const wantPk = Object.entries(table.columns)
      .filter(([, c]) => c.primaryKey)
      .map(([n]) => n);
    for (const cpk of Object.values(table.compositePrimaryKeys ?? {})) {
      wantPk.push(...cpk.columns);
    }
    const livePk = tableConstraints.find((c) => c.type === "p");
    if (wantPk.length > 0) {
      if (!livePk) {
        fail("MISSING PRIMARY KEY", `${name} (${wantPk.join(", ")})`);
      } else if (colKey(wantPk) !== colKey(livePk.columns)) {
        fail(
          "PRIMARY KEY COLUMNS",
          `${name} — snapshot (${wantPk.join(", ")}), built (${livePk.columns.join(", ")})`,
        );
      }
    } else if (livePk) {
      fail("UNEXPECTED PRIMARY KEY", `${name} (${livePk.columns.join(", ")})`);
    }

    // --- unique constraints ---
    // Compared by COLUMN SET: uniqueness enforced by a unique index is
    // equivalent to a unique constraint, and this codebase has expressed the
    // same rule both ways over time.
    const wantUnique = new Set();
    for (const unique of Object.values(table.uniqueConstraints ?? {})) {
      wantUnique.add(colKey(unique.columns));
    }
    for (const index of Object.values(table.indexes ?? {})) {
      if (index.isUnique) wantUnique.add(colKey(index.columns.map((c) => c.expression)));
    }

    const liveUniqueConstraints = tableConstraints.filter((c) => c.type === "u");
    const liveUnique = new Set([
      ...liveUniqueConstraints.map((c) => colKey(c.columns)),
      ...tableIndexes.filter((i) => i.is_unique && !i.is_primary).map((i) => colKey(i.columns)),
    ]);
    for (const wanted of wantUnique) {
      if (!liveUnique.has(wanted)) fail("MISSING UNIQUE", `${name} (${wanted})`);
    }
    for (const live of liveUniqueConstraints) {
      if (!wantUnique.has(colKey(live.columns))) {
        fail("UNEXPECTED UNIQUE", `${name}.${live.name} (${live.columns.join(", ")})`);
      }
    }

    // --- check constraints (by name; Postgres rewrites the expression text) ---
    const wantChecks = new Set(
      Object.values(table.checkConstraints ?? {}).map((check) => check.name),
    );
    const liveChecks = tableConstraints.filter((c) => c.type === "c");
    for (const wanted of wantChecks) {
      if (!liveChecks.some((c) => c.name === wanted)) fail("MISSING CHECK", `${name}.${wanted}`);
    }
    for (const live of liveChecks) {
      if (!wantChecks.has(live.name)) fail("UNEXPECTED CHECK", `${name}.${live.name}`);
    }

    // --- foreign keys: target table, columns and delete rule ---
    const wantFks = table.foreignKeys ?? {};
    const liveFks = tableConstraints.filter((c) => c.type === "f");
    const liveFkByName = new Map(liveFks.map((c) => [c.name, c]));
    for (const fk of Object.values(wantFks)) {
      const live = liveFkByName.get(fk.name);
      if (!live) {
        fail("MISSING FOREIGN KEY", `${name}.${fk.name} → ${fk.tableTo}`);
        continue;
      }
      if (live.ref_table !== fk.tableTo) {
        fail(
          "FOREIGN KEY TARGET",
          `${name}.${fk.name} — snapshot ${fk.tableTo}, built ${live.ref_table}`,
        );
      }
      if (colKey(fk.columnsFrom) !== colKey(live.columns)) {
        fail(
          "FOREIGN KEY COLUMNS",
          `${name}.${fk.name} — snapshot (${fk.columnsFrom.join(", ")}), built (${live.columns.join(", ")})`,
        );
      }
      const wantRule = (fk.onDelete ?? "no action").toLowerCase();
      const liveRule = DELETE_RULE[live.delete_rule] ?? "no action";
      if (wantRule !== liveRule) {
        fail("FOREIGN KEY ON DELETE", `${name}.${fk.name} — snapshot ${wantRule}, built ${liveRule}`);
      }
    }
    for (const live of liveFks) {
      if (!wantFks[live.name]) {
        fail("UNEXPECTED FOREIGN KEY", `${name}.${live.name} → ${live.ref_table}`);
      }
    }

    // --- indexes ---
    const liveIndexByName = new Map(tableIndexes.map((i) => [i.name, i]));
    for (const index of Object.values(table.indexes ?? {})) {
      const live = liveIndexByName.get(index.name);
      if (!live) {
        fail("MISSING INDEX", `${name}.${index.name}`);
        continue;
      }
      const wantColumns = index.columns.map((c) => c.expression);
      if (colKey(wantColumns) !== colKey(live.columns)) {
        fail(
          "INDEX COLUMNS",
          `${name}.${index.name} — snapshot (${wantColumns.join(", ")}), built (${live.columns.join(", ")})`,
        );
      }
      if (!!index.isUnique !== live.is_unique) {
        fail(
          "INDEX UNIQUENESS",
          `${name}.${index.name} — snapshot ${index.isUnique ? "unique" : "non-unique"}, built ${live.is_unique ? "unique" : "non-unique"}`,
        );
      }
    }
    // Constraint-backed indexes are skipped: they are implied by the primary
    // key / unique checks above rather than declared separately in a snapshot.
    for (const live of tableIndexes) {
      if (live.backing_constraint || live.is_primary) continue;
      if (!table.indexes?.[live.name]) fail("UNEXPECTED INDEX", `${name}.${live.name}`);
    }
  }

  for (const name of built.columns.keys()) {
    if (name === "__drizzle_migrations") continue;
    if (!snapshotTableNames.has(name)) fail("UNEXPECTED TABLE", name);
  }

  return problems;
}

/** Load the journal and the snapshot it points at. */
export function loadMigrationPlan(migrationsDir) {
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
  );
  const latest = journal.entries[journal.entries.length - 1];
  const snapshotFile = path.join(
    migrationsDir,
    `meta/${String(latest.idx).padStart(4, "0")}_snapshot.json`,
  );
  return {
    journal,
    snapshotFile,
    snapshot: JSON.parse(fs.readFileSync(snapshotFile, "utf8")),
  };
}

/**
 * Apply every migration in journal order.
 *
 * @returns {string[]} failures; empty means every statement applied.
 */
export async function applyMigrations(client, migrationsDir, journal, { quiet = false } = {}) {
  const failures = [];
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(migrationsDir, `${entry.tag}.sql`), "utf8");
    const statements = sql
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) {
      try {
        await client.query(statement);
      } catch (err) {
        failures.push(`${entry.tag}: ${err.message}\n    ${statement.slice(0, 160)}`);
      }
    }
    if (!quiet) console.log(`applied ${entry.tag} (${statements.length} statements)`);
  }
  return failures;
}
