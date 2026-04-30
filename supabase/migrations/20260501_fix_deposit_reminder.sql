-- =============================================================
-- Disable the deposit-reminder cron notification.
-- The current implementation fires for ALL pending bookings
-- even when deposit_amount is NULL / 0, producing misleading
-- "Pay UGX 0 via MoMo" push notifications.
-- The Homatt booking flow does not require upfront deposits, so
-- the reminder is removed entirely.
-- =============================================================

-- 1. Unschedule the cron job (safe to run even if it doesn't exist)
select cron.unschedule('deposit-reminder');

-- 2. Drop the function so it cannot be re-invoked manually
drop function if exists cron_deposit_reminder();
