import { describe, expect, it } from "vitest";
import {
  constantTimeEqualHex,
  createRecoveryCode,
  deriveRecoveryCode,
  internalEmailForUsername,
  normalizeRecoveryCode,
  normalizeUsername,
  recoveryCodeDigest,
  validateUsername
} from "../src/crypto";

describe("account identifiers", () => {
  it("normalizes and validates public usernames", () => {
    expect(normalizeUsername("  Alice_01 ")).toBe("alice_01");
    expect(validateUsername("alice_01")).toBe(true);
    expect(validateUsername("two words")).toBe(false);
    expect(validateUsername("ab")).toBe(false);
  });

  it("derives a deterministic non-deliverable internal email", async () => {
    const first = await internalEmailForUsername("Alice", "pepper");
    const second = await internalEmailForUsername("alice", "pepper");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}@account\.deepstudy\.invalid$/);
    expect(first).not.toContain("alice");
  });
});

describe("recovery codes", () => {
  it("creates a high-entropy display code and normalizes separators", () => {
    const code = createRecoveryCode();
    expect(code).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    expect(normalizeRecoveryCode(code)).toHaveLength(16);
  });

  it("stores only a peppered digest and compares it without early exit", async () => {
    const left = await recoveryCodeDigest("ABCD-EFGH-JKLM-NPQR", "pepper");
    const same = await recoveryCodeDigest("abcdefghjklmnpqr", "pepper");
    const other = await recoveryCodeDigest("ABCD-EFGH-JKLM-NPQS", "pepper");
    expect(left).toBe(same);
    expect(constantTimeEqualHex(left, same)).toBe(true);
    expect(constantTimeEqualHex(left, other)).toBe(false);
  });

  it("derives a stable per-user generation code without storing plaintext", async () => {
    const first = await deriveRecoveryCode("user-1", 1, "pepper");
    expect(first).toMatch(/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
    await expect(deriveRecoveryCode("user-1", 1, "pepper")).resolves.toBe(first);
    await expect(deriveRecoveryCode("user-1", 2, "pepper")).resolves.not.toBe(first);
  });
});
