/**
 * Drift-detection tests for the migration validator.
 *
 * The point of these tests: the validator is only useful if it FAILS on drift,
 * and a checker that silently passes looks exactly like a checker that works.
 * Each case below starts from a schema that matches its snapshot, injects one
 * specific class of drift, and asserts that class is reported — in both
 * directions, so an object that exists but is undeclared fails just as loudly
 * as a declared object that is missing.
 *
 * These run against synthetic structures rather than a live server so they need
 * no database. The SQL that produces those structures is exercised by running
 * `validate-migrations.mjs` itself against a real Postgres instance.
 *
 * Run: node --test scripts/lib/schema-diff.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { diffAgainstSnapshot, expectedPgType, normalizeDefault } from "./schema-diff.mjs";

/** A small snapshot exercising every object type the diff understands. */
function makeSnapshot() {
  return {
    tables: {
      "public.users": {
        name: "users",
        columns: {
          id: { name: "id", type: "text", primaryKey: true, notNull: true },
          email: { name: "email", type: "text", primaryKey: false, notNull: false },
          active: {
            name: "active",
            type: "boolean",
            primaryKey: false,
            notNull: true,
            default: false,
          },
        },
        indexes: {},
        foreignKeys: {},
        compositePrimaryKeys: {},
        uniqueConstraints: {
          users_email_unique: { name: "users_email_unique", columns: ["email"] },
        },
        checkConstraints: {},
      },
      "public.posts": {
        name: "posts",
        columns: {
          id: { name: "id", type: "text", primaryKey: true, notNull: true },
          author_id: { name: "author_id", type: "text", primaryKey: false, notNull: true },
          rank: { name: "rank", type: "integer", primaryKey: false, notNull: false },
        },
        indexes: {
          posts_author_idx: {
            name: "posts_author_idx",
            columns: [{ expression: "author_id", isExpression: false }],
            isUnique: false,
          },
        },
        foreignKeys: {
          posts_author_id_users_id_fk: {
            name: "posts_author_id_users_id_fk",
            tableFrom: "posts",
            tableTo: "users",
            columnsFrom: ["author_id"],
            columnsTo: ["id"],
            onDelete: "cascade",
            onUpdate: "no action",
          },
        },
        compositePrimaryKeys: {},
        uniqueConstraints: {},
        checkConstraints: {
          posts_rank_positive: { name: "posts_rank_positive", value: '"rank" > 0' },
        },
      },
    },
  };
}

/** Build the introspection result a correct migration chain would produce. */
function makeBuilt() {
  const columns = new Map([
    [
      "users",
      new Map([
        ["id", col("users", "id", "text", true, null)],
        ["email", col("users", "email", "text", false, null)],
        ["active", col("users", "active", "boolean", true, "false")],
      ]),
    ],
    [
      "posts",
      new Map([
        ["id", col("posts", "id", "text", true, null)],
        ["author_id", col("posts", "author_id", "text", true, null)],
        ["rank", col("posts", "rank", "integer", false, null)],
      ]),
    ],
  ]);

  const constraints = new Map([
    [
      "users",
      [
        { name: "users_pkey", table_name: "users", type: "p", columns: ["id"] },
        { name: "users_email_unique", table_name: "users", type: "u", columns: ["email"] },
      ],
    ],
    [
      "posts",
      [
        { name: "posts_pkey", table_name: "posts", type: "p", columns: ["id"] },
        {
          name: "posts_rank_positive",
          table_name: "posts",
          type: "c",
          columns: ["rank"],
        },
        {
          name: "posts_author_id_users_id_fk",
          table_name: "posts",
          type: "f",
          columns: ["author_id"],
          ref_table: "users",
          delete_rule: "c",
        },
      ],
    ],
  ]);

  const indexes = new Map([
    [
      "users",
      [
        idx("users", "users_pkey", ["id"], { unique: true, primary: true, backing: "users_pkey" }),
        idx("users", "users_email_unique", ["email"], {
          unique: true,
          backing: "users_email_unique",
        }),
      ],
    ],
    [
      "posts",
      [
        idx("posts", "posts_pkey", ["id"], { unique: true, primary: true, backing: "posts_pkey" }),
        idx("posts", "posts_author_idx", ["author_id"], {}),
      ],
    ],
  ]);

  return { columns, constraints, indexes };
}

function col(table, name, type, notNull, defaultExpr) {
  return {
    table_name: table,
    column_name: name,
    data_type: type,
    not_null: notNull,
    default_expr: defaultExpr,
  };
}

function idx(table, name, columns, { unique = false, primary = false, backing = null } = {}) {
  return {
    name,
    table_name: table,
    is_unique: unique,
    is_primary: primary,
    backing_constraint: backing,
    columns,
  };
}

/** Apply a mutation to a fresh pair and return the reported problems. */
function driftProblems(mutate) {
  const snapshot = makeSnapshot();
  const built = makeBuilt();
  mutate(built, snapshot);
  return diffAgainstSnapshot(built, snapshot);
}

const hasKind = (problems, kind) => problems.some((p) => p.startsWith(`${kind}:`));

test("a schema matching its snapshot reports no drift", () => {
  assert.deepEqual(diffAgainstSnapshot(makeBuilt(), makeSnapshot()), []);
});

test("detects a table the migrations never created", () => {
  const problems = driftProblems((built) => built.columns.delete("posts"));
  assert.ok(hasKind(problems, "MISSING TABLE"), problems.join("\n"));
});

test("detects a table the snapshot does not declare", () => {
  const problems = driftProblems((built) => {
    built.columns.set("orphan", new Map([["id", col("orphan", "id", "text", true, null)]]));
  });
  assert.ok(hasKind(problems, "UNEXPECTED TABLE"), problems.join("\n"));
});

test("detects missing and unexpected columns", () => {
  assert.ok(
    hasKind(
      driftProblems((built) => built.columns.get("users").delete("email")),
      "MISSING COLUMN",
    ),
  );
  assert.ok(
    hasKind(
      driftProblems((built) =>
        built.columns.get("users").set("secret", col("users", "secret", "text", false, null)),
      ),
      "UNEXPECTED COLUMN",
    ),
  );
});

test("detects column type, nullability and default drift", () => {
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.columns.get("posts").get("rank").data_type = "text";
      }),
      "COLUMN TYPE",
    ),
  );
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.columns.get("users").get("email").not_null = true;
      }),
      "COLUMN NULLABILITY",
    ),
  );
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.columns.get("users").get("active").default_expr = "true";
      }),
      "COLUMN DEFAULT",
    ),
  );
});

test("detects primary key drift in both directions", () => {
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.set(
          "users",
          built.constraints.get("users").filter((c) => c.type !== "p"),
        );
      }),
      "MISSING PRIMARY KEY",
    ),
  );

  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.get("users").find((c) => c.type === "p").columns = ["id", "email"];
      }),
      "PRIMARY KEY COLUMNS",
    ),
  );

  // A table the snapshot says has no primary key, but the database does.
  assert.ok(
    hasKind(
      driftProblems((built, snapshot) => {
        delete snapshot.tables["public.users"].columns.id.primaryKey;
      }),
      "UNEXPECTED PRIMARY KEY",
    ),
  );
});

test("detects missing and unexpected unique constraints", () => {
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.set(
          "users",
          built.constraints.get("users").filter((c) => c.type !== "u"),
        );
        built.indexes.set(
          "users",
          built.indexes.get("users").filter((i) => i.name !== "users_email_unique"),
        );
      }),
      "MISSING UNIQUE",
    ),
  );

  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.get("posts").push({
          name: "posts_author_unique",
          table_name: "posts",
          type: "u",
          columns: ["author_id"],
        });
      }),
      "UNEXPECTED UNIQUE",
    ),
  );
});

test("detects missing and unexpected check constraints", () => {
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.set(
          "posts",
          built.constraints.get("posts").filter((c) => c.type !== "c"),
        );
      }),
      "MISSING CHECK",
    ),
  );

  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.get("users").push({
          name: "users_email_shape",
          table_name: "users",
          type: "c",
          columns: ["email"],
        });
      }),
      "UNEXPECTED CHECK",
    ),
  );
});

test("detects foreign key drift including an undeclared key", () => {
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.set(
          "posts",
          built.constraints.get("posts").filter((c) => c.type !== "f"),
        );
      }),
      "MISSING FOREIGN KEY",
    ),
  );

  // The exact drift that shipped: the constraint exists but under the
  // auto-generated "_fkey" name instead of Drizzle's "_fk" convention. It must
  // read as BOTH a missing declared key and an unexpected undeclared one.
  const renamed = driftProblems((built) => {
    built.constraints.get("posts").find((c) => c.type === "f").name = "posts_author_id_fkey";
  });
  assert.ok(hasKind(renamed, "MISSING FOREIGN KEY"), renamed.join("\n"));
  assert.ok(hasKind(renamed, "UNEXPECTED FOREIGN KEY"), renamed.join("\n"));

  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.get("posts").find((c) => c.type === "f").delete_rule = "a";
      }),
      "FOREIGN KEY ON DELETE",
    ),
  );

  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.get("posts").find((c) => c.type === "f").ref_table = "orphan";
      }),
      "FOREIGN KEY TARGET",
    ),
  );

  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.constraints.get("posts").find((c) => c.type === "f").columns = ["id"];
      }),
      "FOREIGN KEY COLUMNS",
    ),
  );
});

test("detects index drift in both directions", () => {
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.indexes.set(
          "posts",
          built.indexes.get("posts").filter((i) => i.name !== "posts_author_idx"),
        );
      }),
      "MISSING INDEX",
    ),
  );

  // The other drift that shipped: an index created only by the live-schema
  // repair path, so it exists in the database but no snapshot declares it.
  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.indexes.get("posts").push(idx("posts", "posts_rank_idx", ["rank"], {}));
      }),
      "UNEXPECTED INDEX",
    ),
  );

  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.indexes.get("posts").find((i) => i.name === "posts_author_idx").columns = ["rank"];
      }),
      "INDEX COLUMNS",
    ),
  );

  assert.ok(
    hasKind(
      driftProblems((built) => {
        built.indexes.get("posts").find((i) => i.name === "posts_author_idx").is_unique = true;
      }),
      "INDEX UNIQUENESS",
    ),
  );
});

test("constraint-backed indexes are not reported as unexpected", () => {
  // Primary-key and unique constraints create indexes implicitly; a snapshot
  // never lists them separately, so flagging them would make every run fail.
  assert.deepEqual(diffAgainstSnapshot(makeBuilt(), makeSnapshot()), []);
});

test("type spellings that differ between Drizzle and Postgres are not drift", () => {
  assert.equal(expectedPgType("timestamp"), "timestamp without time zone");
  assert.equal(expectedPgType("timestamptz"), "timestamp with time zone");
  assert.equal(expectedPgType("serial"), "integer");
  assert.equal(expectedPgType("varchar"), "character varying");
});

test("default comparison ignores casing and casts but not actual values", () => {
  assert.equal(normalizeDefault(false), normalizeDefault("false"));
  assert.equal(normalizeDefault("'[]'::jsonb"), normalizeDefault("'[]'"));
  assert.notEqual(normalizeDefault("'pending'"), normalizeDefault("'active'"));
  assert.equal(normalizeDefault(undefined), null);
});
