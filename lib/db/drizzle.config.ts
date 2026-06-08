import { defineConfig } from "drizzle-kit";
import path from "path";
import { resolveDbConfig } from "./src/connection";

const { host, port, user, password, database, ssl } = resolveDbConfig();

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    host: host as string,
    port: port as number,
    user: user as string,
    password: password as string,
    database: database as string,
    ssl: ssl as boolean | { rejectUnauthorized: boolean } | undefined,
  },
});
