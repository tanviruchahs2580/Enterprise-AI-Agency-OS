import { describe, expect, it } from "vitest";

import { AppError } from "../../packages/core/src/errors.js";
import {
  newCode,
  newId,
  newRequestId,
  shortHash,
} from "../../packages/core/src/ids.js";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("creates distinct UUID v4 identifiers", () => {
    const first = newId();
    const second = newId();

    expect(first).toMatch(UUID_V4);
    expect(second).toMatch(UUID_V4);
    expect(first).not.toBe(second);
  });
});

describe("newRequestId", () => {
  it("prefixes a UUID with req_", () => {
    const requestId = newRequestId();

    expect(requestId).toMatch(new RegExp(`^req_${UUID_V4.source.slice(1, -1)}$`));
    expect(newRequestId()).not.toBe(requestId);
  });
});

describe("newCode", () => {
  it("zero-pads numeric sequences to four digits", () => {
    expect(newCode("TASK", 7)).toBe("TASK-0007");
    expect(newCode("MIS", 42)).toBe("MIS-0042");
    expect(newCode("A", 0)).toBe("A-0000");
  });

  it("does not truncate sequences wider than four digits", () => {
    expect(newCode("TASK", 12345)).toBe("TASK-12345");
  });

  it("rejects invalid prefixes", () => {
    for (const prefix of ["", "1TASK", "TA SK", "TASK!", "-TASK"]) {
      expect(() => newCode(prefix, 1)).toThrow(AppError);
    }
  });

  it("rejects non-string prefixes at runtime", () => {
    for (const prefix of [null, undefined, true, 7, ["A"], {}]) {
      expect(() => newCode(prefix as unknown as string, 1)).toThrow(/must be a string/);
    }
  });

  it("rejects invalid sequences", () => {
    for (const seq of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => newCode("TASK", seq)).toThrow(/non-negative safe integer/);
    }
  });
});

describe("shortHash", () => {
  it("produces deterministic lowercase hexadecimal hashes", () => {
    const first = shortHash("mission:mis_1");
    const second = shortHash("mission:mis_1");

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    expect(shortHash("mission:mis_1", 8)).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash("mission:mis_1", 1)).toMatch(/^[0-9a-f]$/);
    expect(shortHash("mission:mis_1", 64)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the SHA-256 vector for abc", () => {
    expect(shortHash("abc", 64)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("changes when the input changes", () => {
    expect(shortHash("mission:mis_1")).not.toBe(shortHash("mission:mis_2"));
  });

  it("rejects invalid lengths", () => {
    for (const len of [0, 65, 1.5, Number.NaN]) {
      expect(() => shortHash("input", len)).toThrow(/length must be an integer/);
    }
  });

  it("rejects non-string input at runtime", () => {
    expect(() => shortHash(123 as unknown as string)).toThrow(/must be a string/);
  });
});
