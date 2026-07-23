declare module "@deepstudy/sync-contract" {
  export interface ContractValidationResult {
    valid: boolean;
    errors: Array<{ path: string; code: string; message: string }>;
  }

  export function validateMutation(value: unknown, options?: { maxPayloadBytes?: number }): ContractValidationResult;
  export function previewFirstImport(
    input: { localRecords: unknown[]; cloudRecords: unknown[] },
    options?: { maxPayloadBytes?: number }
  ): {
    mergedRecords: Array<Record<string, unknown>>;
    additions: Array<Record<string, unknown>>;
    duplicates: Array<Record<string, unknown>>;
    conflicts: Array<Record<string, unknown>>;
    tombstones: Array<Record<string, unknown>>;
    counts: Record<string, number>;
  };
  export function snapshotHash(records: unknown[], options?: { maxPayloadBytes?: number }): string;
  export function stableStringify(value: unknown): string;
}
