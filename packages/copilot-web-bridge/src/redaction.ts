import { BridgeError } from "./errors.js";

export interface RedactionResult {
  text: string;
  redactions: Array<{ type: string; count: number }>;
}

const BLOCKED_PATTERNS = [
  {
    type: "private-key",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i,
  },
  {
    type: "aws-credentials-file",
    pattern: /\[(?:default|profile [^\]]+)\][\s\S]{0,500}aws_secret_access_key\s*=/i,
  },
  {
    type: "service-account",
    pattern: /"type"\s*:\s*"service_account"[\s\S]{0,1000}"private_key"\s*:/i,
  },
];

const REDACTION_PATTERNS = [
  {
    type: "authorization-header",
    pattern: /\bAuthorization:\s*(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/gi,
  },
  { type: "github-token", pattern: /\b(?:ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}\b/g },
  { type: "openai-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { type: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  {
    type: "env-secret",
    pattern:
      /^(?<name>[A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(?<value>.+)$/gm,
  },
];

export function redactSensitiveContent(
  text: string,
  maxChars: number,
): RedactionResult {
  if (text.length > maxChars) {
    throw new BridgeError(
      "prompt_too_large",
      `Prompt and context exceed the ${maxChars} character limit.`,
      { length: text.length, maxChars },
    );
  }

  for (const blocked of BLOCKED_PATTERNS) {
    if (blocked.pattern.test(text)) {
      throw new BridgeError(
        "sensitive_content_blocked",
        `Refusing to send detected ${blocked.type} material.`,
        { type: blocked.type },
      );
    }
  }

  const counts = new Map<string, number>();
  let output = text;
  for (const entry of REDACTION_PATTERNS) {
    output = output.replace(entry.pattern, (...args: unknown[]) => {
      counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
      const match = String(args[0]);
      if (entry.type === "env-secret") {
        const groups = args.at(-1) as Record<string, string> | undefined;
        return `${groups?.name ?? "SECRET"}=[REDACTED:${entry.type}]`;
      }
      if (entry.type === "authorization-header") {
        return "Authorization: [REDACTED:authorization-header]";
      }
      return `[REDACTED:${entry.type}]${preserveTrailingPunctuation(match)}`;
    });
  }

  return {
    text: output,
    redactions: Array.from(counts, ([type, count]) => ({ type, count })),
  };
}

function preserveTrailingPunctuation(value: string): string {
  const match = value.match(/[.,;:!?)]$/);
  return match?.[0] ?? "";
}
