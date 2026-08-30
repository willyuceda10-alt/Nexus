-- Bridata H4 - PMO Senior workspace role
-- PostgreSQL enum extension is additive and preserves existing memberships.

ALTER TYPE "WorkspaceRole" ADD VALUE IF NOT EXISTS 'PMO_SENIOR' AFTER 'ADMIN';
