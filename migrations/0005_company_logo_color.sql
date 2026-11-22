-- The color of a company's monogram (the tile with its initial, shown when it has no logo),
-- by key from LOGO_COLORS in src/shared/logo.ts. Null is the default, the app's ultramarine.
ALTER TABLE companies ADD COLUMN logo_color TEXT;
