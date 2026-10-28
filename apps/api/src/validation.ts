import { z } from "zod";

import { AppError, MISSION_STATES, TASK_STATES } from "@agency/core";

const title = z.string().trim().min(1).max(200);
const description = z.string().trim().max(4000).default("");
const limit = z.coerce.number().int().min(1).max(100).default(20);
const offset = z.coerce.number().int().min(0).max(100_000).default(0);
const uuid = z.string().uuid();
const reason = z.string().trim().min(1).max(500).optional();
const isoUtc = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "Expected an ISO-8601 UTC timestamp with milliseconds",
  )
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) &&
      new Date(value).toISOString() === value,
    "Expected a valid UTC timestamp",
  );

export const createMissionSchema = z
  .object({
    title,
    description,
  })
  .strict();

export const createTaskSchema = z
  .object({
    title,
    description,
  })
  .strict();

export const missionTransitionSchema = z
  .object({
    to: z.enum(MISSION_STATES),
    expectedVersion: z.number().int().min(0),
    reason,
  })
  .strict();

export const taskTransitionSchema = z
  .object({
    to: z.enum(TASK_STATES),
    expectedVersion: z.number().int().min(0),
    reason,
  })
  .strict();

export const listQuerySchema = z
  .object({
    limit,
    offset,
  })
  .strict();

export const missionParamsSchema = z.object({ missionId: uuid }).strict();
export const taskParamsSchema = z.object({ taskId: uuid }).strict();

export const listEventsQuerySchema = z
  .object({
    aggregateType: z.enum(["MISSION", "TASK"]).optional(),
    aggregateId: uuid.optional(),
    limit,
    offset,
  })
  .strict();

export const auditExportQuerySchema = z
  .object({
    from: isoUtc.optional(),
    to: isoUtc.optional(),
    format: z.enum(["json", "ndjson"]).default("ndjson"),
    limit: z.coerce.number().int().min(1).max(10_000).default(1_000),
  })
  .strict()
  .refine(
    (value) =>
      value.from === undefined ||
      value.to === undefined ||
      value.from <= value.to,
    { message: "from must be before or equal to to", path: ["from"] },
  );

export type CreateMissionBody = z.infer<typeof createMissionSchema>;
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
export type MissionTransitionBody = z.infer<typeof missionTransitionSchema>;
export type TaskTransitionBody = z.infer<typeof taskTransitionSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
export type MissionParams = z.infer<typeof missionParamsSchema>;
export type TaskParams = z.infer<typeof taskParamsSchema>;
export type ListEventsQuery = z.infer<typeof listEventsQuerySchema>;
export type AuditExportQuery = z.infer<typeof auditExportQuerySchema>;

export function parseInput<T>(
  schema: z.ZodType<T>,
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
  throw AppError.validation(`Invalid ${label}`, { issues });
}
