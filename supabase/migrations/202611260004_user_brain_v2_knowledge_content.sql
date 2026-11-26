-- "Your knowledge" box (26 Nov 2026): a per-user, private field for the user's own
-- professional knowledge (reviewed summaries of CPD, books, Faculty papers).
-- Owned by the User Brain (docs/nora-v2/NORA_V2_OPERATING_SYSTEM.md section 2:
-- "user-specific professional knowledge"). Never read for any other user.
-- Rollback: ALTER TABLE public.user_brain_v2 DROP COLUMN knowledge_content;
ALTER TABLE public.user_brain_v2 ADD COLUMN IF NOT EXISTS knowledge_content text;
