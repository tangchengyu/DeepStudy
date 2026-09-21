const DAY_MS = 86_400_000;

export function syncAvailabilityError(error: unknown, now = Date.now()) {
  const messages: string[] = [];
  let cause: unknown = error;
  for (let depth = 0; cause && depth < 5; depth += 1) {
    messages.push(cause instanceof Error ? cause.message : String(cause));
    cause = cause instanceof Error ? cause.cause : null;
  }
  const message = messages.join(" ");
  const dailyRead = /daily (?:row )?read limit/i.test(message);
  const dailyWrite = /daily (?:row )?write limit/i.test(message);
  if (dailyRead || dailyWrite) {
    const retryAfterSeconds = Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000));
    return {
      error: dailyRead ? "SYNC_DAILY_READ_LIMIT" : "SYNC_DAILY_WRITE_LIMIT",
      message: "同步服务今日额度已用完，额度每天北京时间 08:00 重置。本机更改已保留，重置后会自动重试，无需退出账号或重复导入。",
      retryAfterSeconds,
      retryAt: new Date(now + retryAfterSeconds * 1000).toISOString()
    };
  }
  if (/SQLITE_FULL|database or disk is full|D1.*storage limit/i.test(message)) {
    return {
      error: "SYNC_STORAGE_LIMIT",
      message: "同步服务存储空间不足，请联系服务维护者处理。本机更改已保留，无需退出账号或删除资料。"
    };
  }
  return null;
}
