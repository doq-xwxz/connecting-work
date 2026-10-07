import nextEnv from "@next/env";
import { defineConfig } from "prisma/config";

nextEnv.loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // Generation/validation/build must work without live credentials.
  // Commands connecting to DB validate the URL through CLI or db:smoke.
  datasource: { url: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? "" },
});
