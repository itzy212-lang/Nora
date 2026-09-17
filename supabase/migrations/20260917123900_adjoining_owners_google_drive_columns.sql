-- Real, confirmed bug: adjoining_owners (the real, going-forward AO
-- data source, per the 2026-09-03 migration comment in
-- src/utils/adjoiningOwners.js) had onedrive_folder_id/
-- onedrive_folder_url columns but no Google Drive equivalent at all.
-- So even once the app correctly created an AO's Google Drive
-- subfolder and the frontend correctly set google_drive_folder_id on
-- the AO object, saveAdjoiningOwners' fixed column mapping (toTableRow)
-- silently dropped it before it ever reached this table — only the
-- legacy JSON column (projects.aos) retained it, which nothing
-- authoritative reads from anymore.

ALTER TABLE adjoining_owners ADD COLUMN IF NOT EXISTS google_drive_folder_id text;
ALTER TABLE adjoining_owners ADD COLUMN IF NOT EXISTS google_drive_folder_url text;
