import Database from "better-sqlite3";
export function initDatabase(options) {
    const db = new Database(options.databasePath);
    try {
        db.pragma("journal_mode = WAL");
        db.exec(`
      CREATE TABLE IF NOT EXISTS project (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        name TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL DEFAULT '{}',
        output_json TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        kind TEXT NOT NULL,
        path TEXT,
        content_json TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        run_id TEXT,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        context_json TEXT NOT NULL DEFAULT '{}',
        decision_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE SET NULL
      );
    `);
        db.prepare(`
      INSERT INTO project (id, name, metadata_json, created_at, updated_at)
      VALUES (1, ?, '{}', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        updated_at = excluded.updated_at
    `).run(options.projectName, options.createdAt, options.createdAt);
    }
    finally {
        db.close();
    }
}
//# sourceMappingURL=init.js.map