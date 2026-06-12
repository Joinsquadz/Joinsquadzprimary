import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { resolveDbConfig } from "./connection";

const { Pool } = pg;

export const pool = new Pool(resolveDbConfig());
export const db = drizzle(pool, { schema });

export { resolveDbConfig } from "./connection";
export * from "./schema";
