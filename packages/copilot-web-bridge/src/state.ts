import Database from "better-sqlite3";
import { chmodSync } from "node:fs";
import type { ConversationRecord } from "./protocol.js";

export class StateStore {
  private readonly database: Database.Database;

  constructor(filePath: string) {
    this.database = new Database(filePath);
    chmodSync(filePath, 0o600);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      create table if not exists conversations (
        id text primary key,
        url text not null,
        title text,
        status text not null,
        created_at text not null,
        last_used_at text not null
      );
    `);
  }

  upsert(record: ConversationRecord): void {
    this.database.prepare(`
      insert into conversations (id, url, title, status, created_at, last_used_at)
      values (@id, @url, @title, @status, @createdAt, @lastUsedAt)
      on conflict(id) do update set
        url = excluded.url,
        title = excluded.title,
        status = excluded.status,
        last_used_at = excluded.last_used_at
    `).run(record);
  }

  get(id: string): ConversationRecord | undefined {
    const row = this.database.prepare(`
      select id, url, title, status, created_at, last_used_at
      from conversations where id = ?
    `).get(id) as ConversationRow | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(): ConversationRecord[] {
    return (this.database.prepare(`
      select id, url, title, status, created_at, last_used_at
      from conversations order by last_used_at desc
    `).all() as ConversationRow[]).map(fromRow);
  }

  closeConversation(id: string): void {
    this.database.prepare(`
      update conversations set status = 'closed', last_used_at = ? where id = ?
    `).run(new Date().toISOString(), id);
  }

  deleteAll(): void {
    this.database.prepare("delete from conversations").run();
  }

  close(): void {
    this.database.close();
  }
}

interface ConversationRow {
  id: string;
  url: string;
  title: string | null;
  status: ConversationRecord["status"];
  created_at: string;
  last_used_at: string;
}

function fromRow(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    url: row.url,
    title: row.title ?? undefined,
    status: row.status,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}
