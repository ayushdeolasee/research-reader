use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;

use crate::database;
use crate::models::RrManifest;

/// Session state for a currently open .rr file.
/// The .rr file is extracted to a temp directory for editing,
/// and re-packed on save.
pub struct RrSession {
    /// Path to the original .rr file on disk
    pub rr_path: PathBuf,
    /// Temp directory where we extracted the contents
    pub work_dir: PathBuf,
    /// SQLite connection to data.sqlite in work_dir
    pub db: rusqlite::Connection,
}

impl RrSession {
    /// Path to the extracted PDF within the working directory
    pub fn pdf_path(&self) -> PathBuf {
        self.work_dir.join("document.pdf")
    }
}

/// Open an existing .rr file: extract to temp dir, open SQLite.
pub fn open_rr(rr_path: &Path) -> Result<RrSession, String> {
    let work_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temp dir: {}", e))?
        .keep();

    // Extract the ZIP
    let file = fs::File::open(rr_path).map_err(|e| format!("Failed to open .rr file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read .rr archive: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read archive entry: {}", e))?;
        let out_path = work_dir.join(entry.name());

        if entry.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| format!("Failed to create dir: {}", e))?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Failed to create parent dir: {}", e))?;
            }
            let mut out_file =
                fs::File::create(&out_path).map_err(|e| format!("Failed to create file: {}", e))?;
            std::io::copy(&mut entry, &mut out_file)
                .map_err(|e| format!("Failed to extract file: {}", e))?;
        }
    }

    // Open SQLite
    let db_path = work_dir.join("data.sqlite");
    let db = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    database::init_db(&db).map_err(|e| format!("Failed to init database: {}", e))?;

    Ok(RrSession {
        rr_path: rr_path.to_path_buf(),
        work_dir,
        db,
    })
}

/// Import a raw PDF into a new .rr file.
/// Creates the .rr container next to the PDF (or at the specified output path).
pub fn import_pdf(pdf_path: &Path, output_path: Option<&Path>) -> Result<RrSession, String> {
    let rr_path = match output_path {
        Some(p) => p.to_path_buf(),
        None => pdf_path.with_extension("rr"),
    };

    let work_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temp dir: {}", e))?
        .keep();

    // Copy PDF to work dir
    let pdf_dest = work_dir.join("document.pdf");
    fs::copy(pdf_path, &pdf_dest).map_err(|e| format!("Failed to copy PDF: {}", e))?;

    // Create manifest
    let manifest = RrManifest::default();
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Failed to serialize manifest: {}", e))?;
    fs::write(work_dir.join("manifest.json"), &manifest_json)
        .map_err(|e| format!("Failed to write manifest: {}", e))?;

    // Create and initialize SQLite database
    let db_path = work_dir.join("data.sqlite");
    let db = rusqlite::Connection::open(&db_path)
        .map_err(|e| format!("Failed to create database: {}", e))?;
    database::init_db(&db).map_err(|e| format!("Failed to init database: {}", e))?;

    // Store the original filename as metadata
    if let Some(stem) = pdf_path.file_stem().and_then(|s| s.to_str()) {
        database::set_metadata(&db, "title", stem)
            .map_err(|e| format!("Failed to set title: {}", e))?;
    }

    let session = RrSession {
        rr_path,
        work_dir,
        db,
    };

    // Pack immediately so the .rr file exists on disk
    save_rr(&session)?;

    Ok(session)
}

/// Re-pack the working directory into the .rr ZIP file.
pub fn save_rr(session: &RrSession) -> Result<(), String> {
    let file = fs::File::create(&session.rr_path)
        .map_err(|e| format!("Failed to create .rr file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);

    // Add manifest.json (compressed)
    let manifest_path = session.work_dir.join("manifest.json");
    if manifest_path.exists() {
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("manifest.json", options)
            .map_err(|e| format!("Failed to add manifest to archive: {}", e))?;
        let data =
            fs::read(&manifest_path).map_err(|e| format!("Failed to read manifest: {}", e))?;
        zip.write_all(&data)
            .map_err(|e| format!("Failed to write manifest: {}", e))?;
    }

    // Add document.pdf (stored, no compression — fast and preserves bytes)
    let pdf_path = session.work_dir.join("document.pdf");
    if pdf_path.exists() {
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("document.pdf", options)
            .map_err(|e| format!("Failed to add PDF to archive: {}", e))?;
        let mut pdf_file =
            fs::File::open(&pdf_path).map_err(|e| format!("Failed to open PDF: {}", e))?;
        let mut buffer = Vec::new();
        pdf_file
            .read_to_end(&mut buffer)
            .map_err(|e| format!("Failed to read PDF: {}", e))?;
        zip.write_all(&buffer)
            .map_err(|e| format!("Failed to write PDF: {}", e))?;
    }

    // Add data.sqlite (compressed)
    let db_path = session.work_dir.join("data.sqlite");
    if db_path.exists() {
        // Flush WAL to main db file before packing
        session
            .db
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(|e| format!("Failed to checkpoint WAL: {}", e))?;

        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("data.sqlite", options)
            .map_err(|e| format!("Failed to add database to archive: {}", e))?;
        let data = fs::read(&db_path).map_err(|e| format!("Failed to read database: {}", e))?;
        zip.write_all(&data)
            .map_err(|e| format!("Failed to write database: {}", e))?;
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize archive: {}", e))?;

    Ok(())
}

/// Clean up the working directory (call on close).
pub fn cleanup_session(session: &RrSession) {
    let _ = fs::remove_dir_all(&session.work_dir);
}
