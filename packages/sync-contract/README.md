[简体中文](#简体中文) · [English](#english)

## 简体中文

`@deepstudy/sync-contract` 是不依赖框架和 Node.js 内置模块的 ESM 包，供桌面端、Android 客户端和 Cloudflare Worker 共用同步规则。

主要导出：

- `validateRecord` / `assertValidRecord`：校验同步记录信封和默认 256 KiB 的 UTF-8 payload 上限。
- `validateMutation` / `assertValidMutation`：校验包含 `mutationId`、`baseRevision` 和 `record` 的 mutation。
- `snapshotHash`：对记录顺序和对象键顺序不敏感的 SHA-256 快照哈希。
- `previewFirstImport`：生成并集、重复项、冲突分叉和墓碑报告；记录缺失不会被当成删除。
- `createDeterministicForkId`：为内容冲突的旧记录生成可重复的分叉 ID。
- `partitionMutationsByIdempotency`：依据已接收的 mutation ID 过滤重复提交。

运行测试：

```bash
npm test
```

## English

`@deepstudy/sync-contract` is a framework-neutral ESM package with no Node.js built-in dependencies. It shares synchronization rules across the desktop client, Android client, and Cloudflare Worker.

Primary exports:

- `validateRecord` / `assertValidRecord`: validate record envelopes and the default 256 KiB UTF-8 payload limit.
- `validateMutation` / `assertValidMutation`: validate mutations containing `mutationId`, `baseRevision`, and `record`.
- `snapshotHash`: produce an order-independent SHA-256 snapshot hash.
- `previewFirstImport`: report unions, duplicates, conflict forks, and tombstones without treating absence as deletion.
- `createDeterministicForkId`: generate repeatable fork IDs for divergent legacy records.
- `partitionMutationsByIdempotency`: filter repeated submissions using received mutation IDs.

Run the tests:

```bash
npm test
```
