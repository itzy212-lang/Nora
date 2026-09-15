SELECT 
  schemaname,
  tablename,
  rowsecurity,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 't' AND tablename = 'adjoining_owners') as policy_count
FROM pg_tables t
WHERE tablename = 'adjoining_owners'
ORDER BY schemaname, tablename;
