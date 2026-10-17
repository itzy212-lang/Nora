# Nora — instructions for Claude and other implementation agents

Before making any behavioural, prompt, retrieval, memory, reasoning or assembly change to Nora, read `docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md`. If the requested change conflicts with it or introduces duplicate ownership, stop and identify the conflict before implementing.

This applies to both the V2 architecture (`api/lib/v2-*.js`) and, where relevant, V1 (`api/ely-smart.js`) while both remain live.

## Everything must be universal across users and providers

Nora is multi-user. Never build or change a feature only for the owner's own account or stack. Every feature must work the same for every user, whichever providers they use:

- **Mail:** Outlook *or* Gmail (`user_integrations.email_provider`).
- **Storage:** OneDrive *or* Google Drive (`user_integrations.storage_provider`; project folders are `onedrive_folder_id` / `google_drive_folder_id`).
- Never hard-code an email address or a single account as the user; use the logged-in user (`getCurrentUserEmail`, `getCurrentUserUuid`, `getUserStorageInfo`).
- Use the provider-neutral layer (`api/lib/provider-context.js`, `api/lib/storage-adapter.js`, `api/lib/attachment-source.js`, `api/storage-*.js`) rather than calling Graph/OneDrive directly from a feature. If a feature can only be done for one provider, say so plainly instead of shipping it silently.
- The owner keeps a separate Gmail/Google Drive test app to check this; features should work there too.
