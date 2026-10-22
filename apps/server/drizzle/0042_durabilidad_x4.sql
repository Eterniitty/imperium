-- Vida de las naves ×4 (22-10-2026, la guerra dura más; el daño no cambia): el casco guardado de las naves que
-- ya existían se multiplica igual, para que no aparezcan dañadas (las clases y diseños ya traen sus nuevos máximos).
UPDATE "ships" SET "hull" = "hull" * 4;--> statement-breakpoint
UPDATE "emperors" SET "flagship_hull" = "flagship_hull" * 4;
