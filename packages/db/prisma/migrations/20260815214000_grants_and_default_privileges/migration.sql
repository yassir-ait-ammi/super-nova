-- login_attempts was created after the blanket GRANT in
-- 20260815210000_rls_and_hardening, so nova_app never received privileges
-- on it (GRANT ... ON ALL TABLES only covers tables that already existed).
-- Grant it explicitly, and set a default-privilege rule so every table
-- nova_migrator creates from now on grants nova_app access automatically —
-- this is what makes "a new tenant-owned table without RLS" a loud failure
-- (permission denied) instead of a silent leak, and is asserted directly by
-- the integration test suite.
GRANT SELECT, INSERT, UPDATE, DELETE ON "login_attempts" TO nova_app;

ALTER DEFAULT PRIVILEGES FOR ROLE nova_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO nova_app;
