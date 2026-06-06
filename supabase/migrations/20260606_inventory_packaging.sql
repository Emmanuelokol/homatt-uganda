-- Add packaging columns to clinic_inventory for tab/pack/box selling
ALTER TABLE public.clinic_inventory
  ADD COLUMN IF NOT EXISTS tabs_per_pack        integer       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS packs_per_box        integer       DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pack_selling_price_ugx numeric(12,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS box_selling_price_ugx  numeric(12,2) DEFAULT NULL;

COMMENT ON COLUMN public.clinic_inventory.tabs_per_pack         IS 'Number of base units (tabs/caps/ml) per pack/strip/blister';
COMMENT ON COLUMN public.clinic_inventory.packs_per_box         IS 'Number of packs per box';
COMMENT ON COLUMN public.clinic_inventory.pack_selling_price_ugx IS 'Selling price for one pack (customer pays)';
COMMENT ON COLUMN public.clinic_inventory.box_selling_price_ugx  IS 'Selling price for one box (customer pays)';
