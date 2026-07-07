-- ============================================================================
-- Phase 2 hardening — Co-op wire-protocol version on the session row (MP-24)
-- Run in the Supabase dashboard SQL Editor after 0009. Idempotent.
--
-- The host stamps the session with the wire-protocol version it is running
-- (`PROTOCOL_VERSION` in src/net/coop/protocol.ts). A joining client compares it
-- to its own version and refuses a mismatch (canJoinSession) rather than opening a
-- channel that would silently desync when the message shapes disagree.
--
-- DEPLOY ORDERING: apply this migration BEFORE (or with) the client that inserts
-- `protocol_version`, or createCoopSession's insert will fail on the missing column
-- and co-op hosting will break. The default keeps existing rows compatible; the
-- client treats a null/absent version as compatible for a graceful rollout.
-- ============================================================================

alter table public.coop_sessions
  add column if not exists protocol_version integer not null default 1;

comment on column public.coop_sessions.protocol_version is
  'Co-op wire-protocol version the host is running; joiners refuse a mismatch (MP-24).';
