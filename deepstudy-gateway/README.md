[简体中文](#简体中文) · [English](#english)

# DeepStudy Gateway

## 简体中文

DeepStudy Gateway 是面向 Windows、macOS 和 Android 客户端的 Cloudflare Workers + D1 同步服务。它通过 Firebase Auth 提供用户名/密码账号，并在网关侧提供恢复码、Bearer 会话、离线记录同步、首次旧数据导入、冲突处理，以及专注/休息计时器的显式接管。

### 安全边界

- 生产账号密码由 Firebase Auth 托管；源码、GitHub、D1 和 Worker 环境变量中都不保存用户明文密码。
- 客户端看不到内部邮箱，内部邮箱只由服务端根据用户名生成。
- D1 保存 DeepStudy 用户资料、会话 token 摘要、同步数据和恢复码摘要；网关内部 HMAC 使用独立的 `GATEWAY_SECRET`。
- D1 只保存恢复码的加 pepper 摘要；恢复成功后立即轮换新恢复码并撤销旧会话。
- 如果注册在返回恢复码前意外中断，用户可在验证当前密码和 Turnstile 后调用 `/v1/auth/recovery/regenerate` 安全生成新的恢复码。
- 生产 Turnstile 会严格校验 action 与 `TURNSTILE_ALLOWED_HOSTNAMES`，不能只依赖 token 的 success 字段。
- 冲突解决使用稳定 operation ID 并保存独立的小型结果回执；即使较大的已解决冲突记录已清理，服务端成功但响应丢失时，客户端仍可安全重试并收敛本地状态。
- 每日定时分批清理已过期会话、限流记录和已解决冲突，并只压缩同一实体的旧变更序列；最新记录、最新变更和幂等回执不会被删除。
- `GATEWAY_SECRET`、`RECOVERY_CODE_PEPPER`、`TURNSTILE_SECRET_KEY`、`FIREBASE_SERVICE_ACCOUNT_EMAIL`、`FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` 必须使用 Worker Secrets，不能写入 `wrangler.jsonc`、`.dev.vars.example` 或 GitHub。
- 生产环境不能使用 `local-test-token`；该令牌只在 `ENVIRONMENT` 不是 `production` 时可用于本地测试。

### 本地开发

需要 Node.js 22+。

```bash
npm ci
copy .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

请先把 `.dev.vars` 中占位随机秘密替换为独立的高强度随机值。`.dev.vars` 已被 Git 忽略。本地测试默认使用 `FIREBASE_WEB_API_KEY=local-test-firebase-key` 的本地 Firebase Auth 替身，不会访问生产 Firebase 项目。

验证命令：

```bash
npm run typecheck
npm test
```

测试会在真实 Workers 运行时和本地 D1 中覆盖注册、登录、恢复码轮换、幂等同步、冲突解决、旧数据导入，以及“接管并继续”的计时器租约。

### 生产部署

生产账号认证使用 Firebase Auth。部署前需要先在 Firebase 项目中启用 Email/Password 登录，并准备 Web API Key、Project ID，以及具备 Identity Toolkit 管理权限的服务账号。

1. 登录 Cloudflare：`npx wrangler login`。
2. 创建 D1：`npx wrangler d1 create deepstudy-sync`。
3. 把返回的数据库 ID、Firebase Web API Key、Firebase Project ID、正式 Worker URL 和 Turnstile Site Key 填入 `wrangler.jsonc` 的 `env.production`。
4. 分别执行以下命令写入秘密，不要把秘密粘贴进任何仓库文件：

```bash
npx wrangler secret put GATEWAY_SECRET --env production
npx wrangler secret put RECOVERY_CODE_PEPPER --env production
npx wrangler secret put TURNSTILE_SECRET_KEY --env production
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_EMAIL --env production
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY --env production
```

5. 执行 `npm run db:migrate:remote`，再执行 `npm run deploy`。
6. 使用真实 Turnstile token 运行生产 CPU 冒烟测试：

```bash
DEEPSTUDY_GATEWAY_URL=https://your-worker.example \
DEEPSTUDY_TURNSTILE_TOKENS=token1,token2,... \
npm run cpu:smoke
```

Turnstile token 是一次性的。默认测试需要 12 个刚生成且互不重复的 token；脚本不会打印恢复码、会话令牌或响应正文。

此方案适合小规模免费试点，但第三方免费额度和政策可能变化，不能保证永久免费。生产发布前必须确认 Cloudflare、Firebase 和 Turnstile 当时的免费额度，并确保认证、同步和恢复码请求没有 CPU 或配额错误。

## English

DeepStudy Gateway is a Cloudflare Workers and D1 synchronization service for the Windows, macOS, and Android clients. It uses Firebase Auth for username/password accounts and provides gateway-side recovery codes, bearer sessions, offline record synchronization, first-import merging, conflict resolution, and explicit focus/rest timer takeover.

### Security boundary

- Production account passwords are handled by Firebase Auth. Plaintext passwords are never stored in source control, GitHub, D1, or Worker environment variables.
- Internal email addresses are generated only on the server and are never exposed as account input.
- D1 stores DeepStudy user profiles, session token digests, sync data, and recovery-code digests. Gateway-internal HMAC uses the independent `GATEWAY_SECRET`.
- D1 stores only a peppered recovery-code digest. A successful recovery rotates the code and revokes old sessions.
- If registration is interrupted before the code is delivered, `/v1/auth/recovery/regenerate` can issue a replacement after verifying the current password and Turnstile challenge.
- Production Turnstile verification requires the exact action and an allow-listed hostname.
- Conflict resolution uses a stable operation ID and a compact durable result receipt, allowing safe retry after a lost success response even after the larger resolved-conflict row is cleaned up.
- A daily bounded cleanup removes expired sessions, rate-limit rows, and resolved conflicts while retaining the newest record, newest change, and mutation receipts for durable idempotency.
- `GATEWAY_SECRET`, `RECOVERY_CODE_PEPPER`, `TURNSTILE_SECRET_KEY`, `FIREBASE_SERVICE_ACCOUNT_EMAIL`, and `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` must be Worker Secrets. Never place them in `wrangler.jsonc`, `.dev.vars.example`, or GitHub.
- `local-test-token` is rejected whenever `ENVIRONMENT=production`.

### Local development

Node.js 22 or newer is required.

```bash
npm ci
copy .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Replace the random-secret placeholders in `.dev.vars` before starting. The real `.dev.vars` file is ignored by Git. Local tests use `FIREBASE_WEB_API_KEY=local-test-firebase-key`, which activates a local Firebase Auth stand-in and does not call a production Firebase project.

Run the verification suite with:

```bash
npm run typecheck
npm test
```

The suite exercises registration, sign-in, recovery-code rotation, idempotent synchronization, conflict resolution, legacy import, and explicit timer takeover in the Workers runtime with local D1.

### Production deployment

Production account authentication uses Firebase Auth. Before deploying, enable Email/Password sign-in in Firebase and prepare the Web API Key, Project ID, and a service account with Identity Toolkit administration permissions.

1. Authenticate with `npx wrangler login`.
2. Create D1 with `npx wrangler d1 create deepstudy-sync`.
3. Replace the production database ID, Firebase Web API Key, Firebase Project ID, Worker URL, and Turnstile site key in `wrangler.jsonc`.
4. Add `GATEWAY_SECRET`, `RECOVERY_CODE_PEPPER`, `TURNSTILE_SECRET_KEY`, `FIREBASE_SERVICE_ACCOUNT_EMAIL`, and `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` interactively with `wrangler secret put ... --env production`.
5. Run `npm run db:migrate:remote`, then `npm run deploy`.
6. Run `npm run cpu:smoke` against the real Workers Free deployment with a real Turnstile token.

This architecture is intended to fit a small free-tier pilot. Third-party limits and policies can change, so permanent zero cost cannot be guaranteed.
