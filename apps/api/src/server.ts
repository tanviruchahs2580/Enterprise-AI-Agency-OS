import { randomUUID } from "node:crypto";

import helmet from "@fastify/helmet";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import { AppError } from "@agency/core";

import { authenticate, requireScope, type AuthContext } from "./auth.js";
import type { Database } from "./db.js";
import { parseIdempotencyKey, withIdempotency } from "./idempotency.js";
import { Metrics } from "./metrics.js";
import { RateLimiter } from "./rate-limit.js";
import {
  createMission,
  createTask,
  exportEvents,
  getMission,
  getTask,
  listEvents,
  listMissions,
  listTasks,
  transitionMission,
  transitionTask,
  type Actor,
} from "./repository.js";
import { resolveTraceContext } from "./trace.js";
import {
  auditExportQuerySchema,
  createMissionSchema,
  createTaskSchema,
  listEventsQuerySchema,
  listQuerySchema,
  missionParamsSchema,
  missionTransitionSchema,
  parseInput,
  taskParamsSchema,
  taskTransitionSchema,
} from "./validation.js";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
    traceId: string;
  }
}

export type BuildServerOptions = {
  db: Database;
  logger?: boolean | { level: string; redact: string[] };
  rateLimit?: { max: number; windowMs: number };
};

export async function buildServer(
  options: BuildServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
    requestTimeout: 15_000,
    trustProxy: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });

  const rateLimiter = new RateLimiter(
    options.rateLimit ?? { max: 120, windowMs: 60_000 },
  );
  const metrics = new Metrics();

  app.decorateRequest("auth", null);
  app.decorateRequest("traceId", "");
  app.setErrorHandler(handleError);
  app.setNotFoundHandler(handleNotFound);

  app.addHook("onRequest", async (request, reply) => {
    const trace = resolveTraceContext(request.headers.traceparent, request.id);
    request.traceId = trace.traceId;
    reply.header("traceparent", trace.traceparent);
    reply.header("x-trace-id", trace.traceId);
    metrics.requestStarted();
  });

  app.addHook("onResponse", async (request, reply) => {
    metrics.requestFinished(
      request.method,
      request.routeOptions.url ?? "unmatched",
      reply.statusCode,
      reply.elapsedTime,
    );
  });

  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/readyz", async (_request, reply) => {
    try {
      options.db.prepare("SELECT 1 AS ok").get();
      return { status: "ready" };
    } catch {
      reply.code(503);
      return { status: "unavailable" };
    }
  });

  await app.register(
    async (api) => {
      api.addHook("preHandler", async (request, reply) => {
        const auth = authenticate(options.db, request.headers.authorization);
        request.auth = auth;
        const limit = rateLimiter.consume(auth.tokenId);
        reply.header("x-ratelimit-limit", String(rateLimiter.max));
        reply.header("x-ratelimit-remaining", String(limit.remaining));
        reply.header("x-ratelimit-reset", String(Math.ceil(limit.resetAt / 1000)));
        if (!limit.allowed) {
          throw AppError.rateLimited("Rate limit exceeded", {
            retryAfterSeconds: limit.retryAfterSeconds,
          });
        }
      });

      api.get("/whoami", async (request) => {
        const auth = requireAuth(request);
        return {
          tenantId: auth.tenantId,
          tenantName: auth.tenantName,
          tokenId: auth.tokenId,
          tokenName: auth.tokenName,
          role: auth.role,
          scopes: [...auth.scopes],
          expiresAt: auth.expiresAt,
        };
      });

      api.get("/metrics", async (request, reply) => {
        const auth = requireAuth(request);
        requireScope(auth, "events:read");
        if (auth.role !== "ADMIN") {
          throw AppError.forbidden("Metrics require the ADMIN role");
        }
        reply.type("text/plain; version=0.0.4; charset=utf-8");
        return metrics.render();
      });

      api.post("/missions", async (request, reply) => {
        const auth = requireAuth(request);
        requireScope(auth, "missions:write");
        const body = parseInput(createMissionSchema, request.body, "request body");
        const key = parseIdempotencyKey(request.headers["idempotency-key"]);
        const result = withIdempotency(
          options.db,
          auth.tenantId,
          auth.tokenId,
          key,
          "POST /v1/missions",
          body,
          () => ({
            statusCode: 201,
            body: createMission(options.db, auth.tenantId, body, actorOf(request)),
          }),
        );
        if (result.replayed) reply.header("idempotency-replayed", "true");
        reply.code(result.statusCode);
        return result.body;
      });

      api.get("/missions", async (request) => {
        const auth = requireAuth(request);
        requireScope(auth, "missions:read");
        const query = parseInput(listQuerySchema, request.query, "query");
        return listMissions(options.db, auth.tenantId, query.limit, query.offset);
      });

      api.get("/missions/:missionId", async (request) => {
        const auth = requireAuth(request);
        requireScope(auth, "missions:read");
        const params = parseInput(
          missionParamsSchema,
          request.params,
          "mission id",
        );
        const mission = getMission(options.db, auth.tenantId, params.missionId);
        if (mission === undefined) throw AppError.notFound("Mission");
        return { mission };
      });

      api.post("/missions/:missionId/transitions", async (request, reply) => {
        const auth = requireAuth(request);
        requireScope(auth, "missions:write");
        const params = parseInput(
          missionParamsSchema,
          request.params,
          "mission id",
        );
        const body = parseInput(
          missionTransitionSchema,
          request.body,
          "request body",
        );
        const key = parseIdempotencyKey(request.headers["idempotency-key"]);
        const result = withIdempotency(
          options.db,
          auth.tenantId,
          auth.tokenId,
          key,
          `POST /v1/missions/${params.missionId}/transitions`,
          body,
          () => ({
            statusCode: 200,
            body: transitionMission(
              options.db,
              auth.tenantId,
              params.missionId,
              body,
              actorOf(request),
            ),
          }),
        );
        if (result.replayed) reply.header("idempotency-replayed", "true");
        reply.code(result.statusCode);
        return result.body;
      });

      api.post("/missions/:missionId/tasks", async (request, reply) => {
        const auth = requireAuth(request);
        requireScope(auth, "tasks:write");
        const params = parseInput(
          missionParamsSchema,
          request.params,
          "mission id",
        );
        const body = parseInput(createTaskSchema, request.body, "request body");
        const key = parseIdempotencyKey(request.headers["idempotency-key"]);
        const result = withIdempotency(
          options.db,
          auth.tenantId,
          auth.tokenId,
          key,
          `POST /v1/missions/${params.missionId}/tasks`,
          body,
          () => ({
            statusCode: 201,
            body: createTask(
              options.db,
              auth.tenantId,
              params.missionId,
              body,
              actorOf(request),
            ),
          }),
        );
        if (result.replayed) reply.header("idempotency-replayed", "true");
        reply.code(result.statusCode);
        return result.body;
      });

      api.get("/missions/:missionId/tasks", async (request) => {
        const auth = requireAuth(request);
        requireScope(auth, "tasks:read");
        const params = parseInput(
          missionParamsSchema,
          request.params,
          "mission id",
        );
        const query = parseInput(listQuerySchema, request.query, "query");
        return listTasks(
          options.db,
          auth.tenantId,
          params.missionId,
          query.limit,
          query.offset,
        );
      });

      api.get("/tasks/:taskId", async (request) => {
        const auth = requireAuth(request);
        requireScope(auth, "tasks:read");
        const params = parseInput(taskParamsSchema, request.params, "task id");
        const task = getTask(options.db, auth.tenantId, params.taskId);
        if (task === undefined) throw AppError.notFound("Task");
        return { task };
      });

      api.post("/tasks/:taskId/transitions", async (request, reply) => {
        const auth = requireAuth(request);
        requireScope(auth, "tasks:write");
        const params = parseInput(taskParamsSchema, request.params, "task id");
        const body = parseInput(taskTransitionSchema, request.body, "request body");
        const key = parseIdempotencyKey(request.headers["idempotency-key"]);
        const result = withIdempotency(
          options.db,
          auth.tenantId,
          auth.tokenId,
          key,
          `POST /v1/tasks/${params.taskId}/transitions`,
          body,
          () => ({
            statusCode: 200,
            body: transitionTask(
              options.db,
              auth.tenantId,
              params.taskId,
              body,
              actorOf(request),
            ),
          }),
        );
        if (result.replayed) reply.header("idempotency-replayed", "true");
        reply.code(result.statusCode);
        return result.body;
      });

      api.get("/events", async (request) => {
        const auth = requireAuth(request);
        requireScope(auth, "events:read");
        const query = parseInput(
          listEventsQuerySchema,
          request.query,
          "query",
        );
        return listEvents(options.db, auth.tenantId, query);
      });

      api.get("/audit/export", async (request, reply) => {
        const auth = requireAuth(request);
        requireScope(auth, "events:read");
        const query = parseInput(
          auditExportQuerySchema,
          request.query,
          "query",
        );
        const events = exportEvents(options.db, auth.tenantId, query);
        reply.header(
          "content-disposition",
          `attachment; filename="audit-${auth.tenantId}.${query.format === "ndjson" ? "jsonl" : "json"}"`,
        );
        if (query.format === "json") {
          return {
            tenantId: auth.tenantId,
            exportedAt: new Date().toISOString(),
            count: events.length,
            events,
          };
        }
        reply.type("application/x-ndjson; charset=utf-8");
        return events.map((event) => JSON.stringify(event)).join("\n") + "\n";
      });
    },
    { prefix: "/v1" },
  );

  app.addHook("onClose", async () => {
    if (options.db.isOpen) options.db.close();
  });

  return app;
}

function handleNotFound(request: FastifyRequest, reply: FastifyReply): void {
  reply.header("x-request-id", request.id);
  reply.header("Cache-Control", "no-store");
  reply.code(404).send({
    error: {
      name: "AppError",
      code: "NOT_FOUND",
      message: "Route not found",
      status: 404,
      retryable: false,
      requestId: request.id,
    },
  });
}

function handleError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  reply.header("x-request-id", request.id);
  reply.header("Cache-Control", "no-store");

  if (error instanceof AppError) {
    if (error.code === "UNAUTHENTICATED") {
      reply.header("WWW-Authenticate", 'Bearer realm="agency-api"');
    }
    if (error.code === "RATE_LIMITED") {
      const details = error.details;
      if (
        details !== null &&
        typeof details === "object" &&
        "retryAfterSeconds" in details
      ) {
        const seconds = (details as { retryAfterSeconds?: unknown })
          .retryAfterSeconds;
        if (
          typeof seconds === "number" &&
          Number.isFinite(seconds) &&
          seconds > 0
        ) {
          reply.header("Retry-After", String(Math.ceil(seconds)));
        }
      }
    }
    const payload =
      error.code === "INTERNAL"
        ? {
            name: error.name,
            code: error.code,
            message: "Internal server error",
            status: error.status,
            retryable: error.retryable,
            requestId: request.id,
          }
        : { ...error.toJSON(), requestId: request.id };
    reply.code(error.status).send({ error: payload });
    return;
  }

  const status = typeof error.statusCode === "number" ? error.statusCode : 500;
  if (status >= 400 && status < 500) {
    const code =
      status === 401
        ? "UNAUTHENTICATED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : status === 429
              ? "RATE_LIMITED"
              : "VALIDATION_ERROR";
    if (code === "UNAUTHENTICATED") {
      reply.header("WWW-Authenticate", 'Bearer realm="agency-api"');
    }
    reply.code(status).send({
      error: {
        name: "AppError",
        code,
        message: status === 413 ? "Request body too large" : error.message,
        status,
        retryable: false,
        requestId: request.id,
      },
    });
    return;
  }

  request.log.error({ err: error }, "unhandled request error");
  reply.code(500).send({
    error: {
      name: "AppError",
      code: "INTERNAL",
      message: "Internal server error",
      status: 500,
      retryable: false,
      requestId: request.id,
    },
  });
}

function requireAuth(request: FastifyRequest): AuthContext {
  if (request.auth === null) {
    throw AppError.unauthenticated();
  }
  return request.auth;
}

function actorOf(request: FastifyRequest): Actor {
  return { tokenId: requireAuth(request).tokenId, requestId: request.id };
}
