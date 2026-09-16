-- Create user_integrations table to store OAuth tokens for email and storage providers

create table if not exists user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  
  -- Email provider: 'outlook' or 'gmail'
  email_provider text default 'outlook',
  
  -- Storage provider: 'onedrive' or 'googledrive'
  storage_provider text default 'onedrive',
  
  -- Gmail OAuth tokens
  gmail_access_token text,
  gmail_refresh_token text,
  
  -- Google Drive OAuth tokens
  google_drive_access_token text,
  google_drive_refresh_token text,
  
  -- Store the Active Jobs folder ID so we don't recreate it
  google_drive_active_jobs_folder_id text,
  
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable RLS
alter table user_integrations enable row level security;

-- Users can only read/write their own integrations
create policy "Users can read own integrations"
  on user_integrations for select
  using (auth.uid() = user_id);

create policy "Users can insert own integrations"
  on user_integrations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own integrations"
  on user_integrations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own integrations"
  on user_integrations for delete
  using (auth.uid() = user_id);

-- Service role can do everything (for server-side operations)
create policy "Service role can manage integrations"
  on user_integrations
  using (current_setting('role') = 'service_role')
  with check (current_setting('role') = 'service_role');

create index idx_user_integrations_user_id on user_integrations(user_id);
