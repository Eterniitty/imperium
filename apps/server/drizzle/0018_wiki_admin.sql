CREATE TABLE "wiki_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"slug" text NOT NULL,
	"locale" text,
	"revision_id" bigint,
	"detail" text,
	"author_id" uuid,
	"author_label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_log_action" CHECK ("wiki_log"."action" IN ('save', 'restore', 'create', 'hide', 'show', 'group'))
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"slug" text PRIMARY KEY NOT NULL,
	"group" text NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"custom" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_pages_group" CHECK ("wiki_pages"."group" IN ('start', 'world', 'ship', 'empire', 'war', 'people'))
);
--> statement-breakpoint
CREATE TABLE "wiki_revisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"locale" text NOT NULL,
	"body" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"author_id" uuid,
	"author_label" text,
	"restored_from" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_revisions_locale" CHECK ("wiki_revisions"."locale" IN ('es', 'en'))
);
--> statement-breakpoint
ALTER TABLE "wiki_log" ADD CONSTRAINT "wiki_log_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_revisions" ADD CONSTRAINT "wiki_revisions_author_id_accounts_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wiki_log_slug_idx" ON "wiki_log" USING btree ("slug","id");--> statement-breakpoint
CREATE INDEX "wiki_log_author_idx" ON "wiki_log" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "wiki_revisions_article_idx" ON "wiki_revisions" USING btree ("slug","locale","id");--> statement-breakpoint
CREATE INDEX "wiki_revisions_author_idx" ON "wiki_revisions" USING btree ("author_id");--> statement-breakpoint
-- Añadido a mano: revisiones y registro de la Wiki son solo inserción. La única
-- modificación permitida es dejar anónimo al autor (al borrar su cuenta): quitar
-- `author_id` y, si se quiere, `author_label`, sin tocar nada más.
CREATE FUNCTION "wiki_revisions_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND NEW.author_id IS NULL
		AND (NEW.author_label IS NULL OR NEW.author_label IS NOT DISTINCT FROM OLD.author_label)
		AND (NEW.id, NEW.slug, NEW.locale, NEW.body, NEW.note, NEW.created_at) IS NOT DISTINCT FROM (OLD.id, OLD.slug, OLD.locale, OLD.body, OLD.note, OLD.created_at)
		AND NEW.restored_from IS NOT DISTINCT FROM OLD.restored_from THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'wiki_revisions es solo inserción';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "wiki_revisions_append_only" BEFORE UPDATE OR DELETE ON "wiki_revisions" FOR EACH ROW EXECUTE FUNCTION "wiki_revisions_append_only"();--> statement-breakpoint
CREATE FUNCTION "wiki_log_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'UPDATE'
		AND NEW.author_id IS NULL
		AND (NEW.author_label IS NULL OR NEW.author_label IS NOT DISTINCT FROM OLD.author_label)
		AND (NEW.id, NEW.action, NEW.slug, NEW.locale, NEW.revision_id, NEW.detail, NEW.created_at) IS NOT DISTINCT FROM (OLD.id, OLD.action, OLD.slug, OLD.locale, OLD.revision_id, OLD.detail, OLD.created_at) THEN
		RETURN NEW;
	END IF;
	RAISE EXCEPTION 'wiki_log es solo inserción';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "wiki_log_append_only" BEFORE UPDATE OR DELETE ON "wiki_log" FOR EACH ROW EXECUTE FUNCTION "wiki_log_append_only"();
