-- Existing byte rows gain no implicit scan approval. Real scanner activation is deferred.
ALTER TABLE zhiban_learning_files.files
 ADD COLUMN clearance_status text NOT NULL DEFAULT 'UNVERIFIED' CHECK(clearance_status IN('UNVERIFIED','LOCAL_SYNTHETIC_PINNED')),
 ADD COLUMN clearance_ref text NOT NULL DEFAULT '';
ALTER TABLE zhiban_learning_files.files ADD CONSTRAINT file_clearance_binding CHECK(
 (clearance_status='UNVERIFIED' AND clearance_ref='') OR
 (clearance_status='LOCAL_SYNTHETIC_PINNED' AND clearance_ref='local-synthetic-sha256:'||digest)
);
