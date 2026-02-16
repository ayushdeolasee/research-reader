use std::path::PathBuf;
use std::sync::Mutex;
use tauri::ipc::Response;
use tauri::State;

use crate::database;
use crate::models::*;
use crate::rr_file::{self, RrSession};

/// Application state holding the current session
pub struct AppState {
    pub session: Mutex<Option<RrSession>>,
}

/// Open a .rr file or import a PDF
#[tauri::command]
pub fn open_file(path: String, state: State<AppState>) -> Result<DocumentInfo, String> {
    let path = PathBuf::from(&path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let session = match ext.as_str() {
        "rr" => rr_file::open_rr(&path)?,
        "pdf" => rr_file::import_pdf(&path, None)?,
        _ => return Err(format!("Unsupported file type: .{}", ext)),
    };

    let pdf_path = session.pdf_path().to_string_lossy().to_string();
    let title = database::get_metadata(&session.db, "title")
        .map_err(|e| format!("Failed to read title: {}", e))?;
    let page_count_str = database::get_metadata(&session.db, "page_count")
        .map_err(|e| format!("Failed to read page_count: {}", e))?;
    let last_page_str = database::get_metadata(&session.db, "last_page")
        .map_err(|e| format!("Failed to read last_page: {}", e))?;

    let info = DocumentInfo {
        pdf_path,
        rr_path: session.rr_path.to_string_lossy().to_string(),
        title,
        page_count: page_count_str.and_then(|s| s.parse().ok()),
        last_page: last_page_str.and_then(|s| s.parse().ok()),
    };

    let mut state_session = state.session.lock().map_err(|e| e.to_string())?;
    // Clean up previous session if any
    if let Some(prev) = state_session.take() {
        rr_file::cleanup_session(&prev);
    }
    *state_session = Some(session);

    Ok(info)
}

/// Save the current session back to the .rr file
#[tauri::command]
pub fn save_file(state: State<AppState>) -> Result<(), String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    let session = session.as_ref().ok_or("No file is open")?;
    rr_file::save_rr(session)
}

/// Close the current session
#[tauri::command]
pub fn close_file(state: State<AppState>) -> Result<(), String> {
    let mut session = state.session.lock().map_err(|e| e.to_string())?;
    if let Some(prev) = session.take() {
        // Save before closing
        rr_file::save_rr(&prev)?;
        rr_file::cleanup_session(&prev);
    }
    Ok(())
}

/// Get all annotations, optionally filtered by page
#[tauri::command]
pub fn get_annotations(
    page_number: Option<u32>,
    state: State<AppState>,
) -> Result<Vec<Annotation>, String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    let session = session.as_ref().ok_or("No file is open")?;
    database::get_annotations(&session.db, page_number)
        .map_err(|e| format!("Failed to get annotations: {}", e))
}

/// Create a new annotation
#[tauri::command]
pub fn create_annotation(
    input: CreateAnnotationInput,
    state: State<AppState>,
) -> Result<Annotation, String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    let session = session.as_ref().ok_or("No file is open")?;
    database::create_annotation(&session.db, &input)
        .map_err(|e| format!("Failed to create annotation: {}", e))
}

/// Update an existing annotation
#[tauri::command]
pub fn update_annotation(
    input: UpdateAnnotationInput,
    state: State<AppState>,
) -> Result<bool, String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    let session = session.as_ref().ok_or("No file is open")?;
    database::update_annotation(&session.db, &input)
        .map_err(|e| format!("Failed to update annotation: {}", e))
}

/// Delete an annotation
#[tauri::command]
pub fn delete_annotation(id: String, state: State<AppState>) -> Result<bool, String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    let session = session.as_ref().ok_or("No file is open")?;
    database::delete_annotation(&session.db, &id)
        .map_err(|e| format!("Failed to delete annotation: {}", e))
}

/// Set document metadata (e.g., page_count, last_page, title)
#[tauri::command]
pub fn set_document_metadata(
    key: String,
    value: String,
    state: State<AppState>,
) -> Result<(), String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    let session = session.as_ref().ok_or("No file is open")?;
    database::set_metadata(&session.db, &key, &value)
        .map_err(|e| format!("Failed to set metadata: {}", e))
}

/// Read the PDF bytes for the current session.
/// Returns raw bytes via IPC Response (efficient binary transfer).
#[tauri::command]
pub fn read_pdf_bytes(state: State<AppState>) -> Result<Response, String> {
    let session = state.session.lock().map_err(|e| e.to_string())?;
    let session = session.as_ref().ok_or("No file is open")?;
    let pdf_path = session.pdf_path();
    let bytes = std::fs::read(&pdf_path)
        .map_err(|e| format!("Failed to read PDF at {}: {}", pdf_path.display(), e))?;
    Ok(Response::new(bytes))
}

/// Response for open_file
#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentInfo {
    pub pdf_path: String,
    pub rr_path: String,
    pub title: Option<String>,
    pub page_count: Option<u32>,
    pub last_page: Option<u32>,
}

use serde::{Deserialize, Serialize};
