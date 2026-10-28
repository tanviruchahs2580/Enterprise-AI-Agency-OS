import type { FastifyInstance } from "fastify";

import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { buildServer } from "./server.js";

const config = loadConfig(process.env);
const db = openDatabase(config.databasePath);

let app: FastifyInstance;
try {
  app = await buildServer({
    db,
    logger: {
      level: config.logLevel,
      redact: ["req.headers.authorization"],
    },
  });
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { host: config.host, port: config.port, databasePath: config.databasePath },
    "api listening",
  );
} catch (error) {
  if (db.isOpen) db.close();
  throw error;
}

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
