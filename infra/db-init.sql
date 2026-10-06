-- Runtime role: no superuser, no BYPASSRLS, so row-level security applies to every query.
CREATE ROLE atlas_app LOGIN PASSWORD 'atlas_app' NOSUPERUSER NOBYPASSRLS;
