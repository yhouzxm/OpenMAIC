-- Additive: historical rows keep their original clearance. No implicit promotion.
ALTER TABLE zhiban_learning_files.files DROP CONSTRAINT files_clearance_status_check;
ALTER TABLE zhiban_learning_files.files DROP CONSTRAINT file_clearance_binding;
ALTER TABLE zhiban_learning_files.files ADD CONSTRAINT files_clearance_status_check
 CHECK(clearance_status IN('UNVERIFIED','LOCAL_SYNTHETIC_PINNED','TRUSTED_SCANNER'));
ALTER TABLE zhiban_learning_files.files ADD CONSTRAINT file_clearance_binding CHECK(
 (clearance_status='UNVERIFIED' AND clearance_ref='') OR
 (clearance_status='LOCAL_SYNTHETIC_PINNED' AND clearance_ref='local-synthetic-sha256:'||digest) OR
 (clearance_status='TRUSTED_SCANNER' AND clearance_ref ~ ('^clamav-sha256:[a-f0-9]{64}:'||digest||':[0-9]{13}$'))
);
