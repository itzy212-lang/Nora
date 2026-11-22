alter table public.notice_response_links alter column pdf_bucket drop not null;
alter table public.notice_response_links alter column pdf_path drop not null;
alter table public.notice_response_links alter column original_pdf_sha256 drop not null;
alter table public.notice_response_links alter column original_pdf_bytes drop not null;
