-- 056_crew_totem.sql
-- Crew totems — how a crew finds each other in a crowd.
--
-- Festivals are a sea of people; a crew's "totem" (a tall sign, a flag, an
-- inflatable on a pole) is the real-world landmark members rally to. This lets a
-- crew name that totem and pin an emoji to it so the app can echo the same
-- visual the crowd is scanning for ("look for the 🦩 — Flamingo Squad").
--
-- Both columns are nullable with NO backfill: a crew that never sets a totem
-- just hides the section, and existing crews keep their current behavior
-- verbatim (zero regression). The IF NOT EXISTS guards make each statement
-- additive + idempotent per the repo migration convention (the app-managed
-- runner in lib/planner-db-pg.ts records the version — no manual footer).

ALTER TABLE crews ADD COLUMN IF NOT EXISTS totem_name TEXT;
ALTER TABLE crews ADD COLUMN IF NOT EXISTS totem_emoji TEXT;
