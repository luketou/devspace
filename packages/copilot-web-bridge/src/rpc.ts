import { createConnection, createServer, type Socket } from "node:net";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import type { RpcRequest, RpcResponse } from "./protocol.js";
import { BridgeError } from "./errors.js";

export type RpcHandler = (request: RpcRequest) => Promise<unknown>;

export class RpcSocketServer {
  private server?: ReturnType<typeof createServer>;

  constructor(
    private readonly socketFile: string,
    private readonly handler: RpcHandler,
  ) {}

  async listen(): Promise<void> {
    try {
      unlinkSync(this.socketFile);
    } catch {
      // A missing stale socket is expected.
    }

    this.server = createServer((socket) => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.server?.once("error", reject);
      this.server?.listen(this.socketFile, resolve);
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    this.server = undefined;
    try {
      unlinkSync(this.socketFile);
    } catch {
      // Ignore cleanup races.
    }
  }

  private handleSocket(socket: Socket): void {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const index = buffer.indexOf("\n");
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line.trim()) void this.handleLine(socket, line);
      }
    });
  }

  private async handleLine(socket: Socket, line: string): Promise<void> {
    let request: RpcRequest;
    try {
      request = JSON.parse(line) as RpcRequest;
      const result = await this.handler(request);
      send(socket, { id: request.id, result });
    } catch (error) {
      const bridgeError =
        error instanceof BridgeError
          ? error
          : new BridgeError(
              "internal_error",
              error instanceof Error ? error.message : String(error),
            );
      const id = safelyReadId(line);
      send(socket, {
        id,
        error: {
          code: bridgeError.code,
          message: bridgeError.message,
          details: bridgeError.details,
        },
      });
    }
  }
}

export async function rpcCall<T>(
  socketFile: string,
  request: Omit<RpcRequest, "id">,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = randomUUID();
    const socket = createConnection(socketFile);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("error", (error) => {
      reject(
        new BridgeError(
          "daemon_unavailable",
          `Unable to connect to browser daemon: ${error.message}`,
        ),
      );
    });
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ ...request, id })}\n`);
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (!buffer.includes("\n")) return;
      const line = buffer.slice(0, buffer.indexOf("\n"));
      const response = JSON.parse(line) as RpcResponse;
      socket.end();
      if (response.error) {
        reject(
          new BridgeError(
            response.error.code,
            response.error.message,
            response.error.details,
          ),
        );
      } else {
        resolve(response.result as T);
      }
    });
  });
}

function send(socket: Socket, response: RpcResponse): void {
  socket.write(`${JSON.stringify(response)}\n`);
}

function safelyReadId(line: string): string {
  try {
    const parsed = JSON.parse(line) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : "unknown";
  } catch {
    return "unknown";
  }
}
