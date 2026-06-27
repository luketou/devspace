import { appendFileSync, chmodSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class AuditLog {
  private readonly filePath: string;

  constructor(logDir: string) {
    this.filePath = join(logDir, "audit.jsonl");
    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, "", { mode: 0o600 });
    }
    chmodSync(this.filePath, 0o600);
  }

  write(
    event: string,
    fields: Record<string, string | number | boolean | undefined> = {},
  ): void {
    const sanitized = Object.fromEntries(
      Object.entries(fields).filter((entry) => entry[1] !== undefined),
    );
    appendFileSync(
      this.filePath,
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        event,
        ...sanitized,
      })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
}
