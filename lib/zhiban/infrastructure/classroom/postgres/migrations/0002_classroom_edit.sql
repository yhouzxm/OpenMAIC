-- Additive classroom metadata/window editing. Existing schema, RLS and migrations unchanged.
GRANT UPDATE(title,description,opens_at,closes_at) ON zhiban_classroom.sessions TO zhiban_academic_runtime;
