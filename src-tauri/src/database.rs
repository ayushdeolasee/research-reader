use crate::models::*;
use rusqlite::{params, Connection};

/// Initialize the SQLite database with the required tables.
pub fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS annotations (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL CHECK(type IN ('highlight', 'note', 'bookmark')),
            page_number INTEGER NOT NULL,
            color TEXT,
            content TEXT,
            position_data TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_annotations_page
            ON annotations(page_number);
        CREATE INDEX IF NOT EXISTS idx_annotations_type
            ON annotations(type);
        ",
    )?;
    Ok(())
}

/// Get a metadata value by key.
pub fn get_metadata(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM metadata WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

/// Set a metadata key-value pair (upsert).
pub fn set_metadata(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES (?1, ?2)",
        params![key, value],
    )?;
    Ok(())
}

/// Get all annotations, optionally filtered by page number.
pub fn get_annotations(
    conn: &Connection,
    page_number: Option<u32>,
) -> rusqlite::Result<Vec<Annotation>> {
    let mut annotations = Vec::new();

    let (sql, page_param) = match page_number {
        Some(page) => (
            "SELECT id, type, page_number, color, content, position_data, created_at, updated_at
             FROM annotations WHERE page_number = ?1 ORDER BY created_at ASC",
            Some(page),
        ),
        None => (
            "SELECT id, type, page_number, color, content, position_data, created_at, updated_at
             FROM annotations ORDER BY page_number ASC, created_at ASC",
            None,
        ),
    };

    let mut stmt = conn.prepare(sql)?;

    let rows = if let Some(page) = page_param {
        stmt.query(params![page])?
    } else {
        stmt.query([])?
    };

    let mut rows = rows;
    while let Some(row) = rows.next()? {
        let type_str: String = row.get(1)?;
        let position_data_str: Option<String> = row.get(5)?;

        let annotation = Annotation {
            id: row.get(0)?,
            annotation_type: AnnotationType::from_str(&type_str)
                .map_err(|e| rusqlite::Error::InvalidParameterName(e))?,
            page_number: row.get(2)?,
            color: row.get(3)?,
            content: row.get(4)?,
            position_data: position_data_str.and_then(|s| serde_json::from_str(&s).ok()),
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        };
        annotations.push(annotation);
    }

    Ok(annotations)
}

/// Create a new annotation. Returns the created annotation.
pub fn create_annotation(
    conn: &Connection,
    input: &CreateAnnotationInput,
) -> rusqlite::Result<Annotation> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let position_data_json = input
        .position_data
        .as_ref()
        .map(|pd| serde_json::to_string(pd).unwrap_or_default());

    conn.execute(
        "INSERT INTO annotations (id, type, page_number, color, content, position_data, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            input.annotation_type.as_str(),
            input.page_number,
            input.color,
            input.content,
            position_data_json,
            now,
            now,
        ],
    )?;

    Ok(Annotation {
        id,
        annotation_type: input.annotation_type.clone(),
        page_number: input.page_number,
        color: input.color.clone(),
        content: input.content.clone(),
        position_data: input.position_data.clone(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Update an existing annotation's color, content, and/or position_data.
pub fn update_annotation(
    conn: &Connection,
    input: &UpdateAnnotationInput,
) -> rusqlite::Result<bool> {
    let now = chrono::Utc::now().to_rfc3339();
    let position_data_json = input
        .position_data
        .as_ref()
        .map(|pd| serde_json::to_string(pd).unwrap_or_default());

    let rows_affected = conn.execute(
        "UPDATE annotations SET
            color = COALESCE(?1, color),
            content = COALESCE(?2, content),
            position_data = COALESCE(?3, position_data),
            updated_at = ?4
         WHERE id = ?5",
        params![
            input.color,
            input.content,
            position_data_json,
            now,
            input.id
        ],
    )?;

    Ok(rows_affected > 0)
}

/// Delete an annotation by id. Returns true if it existed.
pub fn delete_annotation(conn: &Connection, id: &str) -> rusqlite::Result<bool> {
    let rows_affected = conn.execute("DELETE FROM annotations WHERE id = ?1", params![id])?;
    Ok(rows_affected > 0)
}
