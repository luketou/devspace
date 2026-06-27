export interface ConversationRecord {
  id: string;
  url: string;
  title?: string;
  status: "open" | "closed" | "unavailable";
  createdAt: string;
  lastUsedAt: string;
}

export interface BridgeStatus {
  daemon: "ready";
  loggedIn: boolean;
  interactiveLoginRequired: boolean;
  activeTabs: number;
  maxTabs: number;
  queuedRequests: number;
  copilotUrl: string;
}

export type RpcRequest =
  | { id: string; method: "status"; params?: undefined }
  | { id: string; method: "conversation.create"; params?: { title?: string } }
  | { id: string; method: "conversation.list"; params?: undefined }
  | { id: string; method: "conversation.close"; params: { conversationId: string } }
  | {
      id: string;
      method: "chat";
      params: {
        conversationId?: string;
        requestId?: string;
        title?: string;
        prompt: string;
        context?: string;
        timeoutSeconds?: number;
      };
    }
  | {
      id: string;
      method: "ask";
      params: {
        conversationId: string;
        requestId?: string;
        prompt: string;
        context?: string;
        timeoutSeconds?: number;
      };
    }
  | { id: string; method: "cancel"; params: { requestId: string } }
  | { id: string; method: "login.start"; params?: undefined }
  | { id: string; method: "logout"; params?: undefined }
  | { id: string; method: "shutdown"; params?: undefined };

export interface RpcResponse {
  id: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface AskResult {
  requestId: string;
  conversationId: string;
  conversationUrl: string;
  response: string;
  redactions: Array<{ type: string; count: number }>;
}
