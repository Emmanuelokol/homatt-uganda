-- ============================================================
-- Homatt Health Uganda — Add prevents_from to marketplace_items
-- Adds a human-readable "Prevents / Protects Against" field so
-- admins can describe what health condition a product prevents,
-- and the mobile app can display it prominently on product cards.
-- Run after: 20260320_preventive_shop_upgrade.sql
-- ============================================================

alter table marketplace_items
  add column if not exists prevents_from text;
