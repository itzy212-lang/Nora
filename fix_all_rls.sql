-- Get all read-only policies that need fixing
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  qual
FROM pg_policies 
WHERE schemaname = 'public' 
  AND qual IS NOT NULL 
  AND with_check IS NULL;
