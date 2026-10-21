ALTER TABLE "wiki_log" DROP CONSTRAINT "wiki_log_action";--> statement-breakpoint
ALTER TABLE "wiki_pages" DROP CONSTRAINT "wiki_pages_group";--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "byline" text;--> statement-breakpoint
ALTER TABLE "wiki_log" ADD CONSTRAINT "wiki_log_action" CHECK ("wiki_log"."action" IN ('save', 'restore', 'create', 'hide', 'show', 'group', 'byline'));--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_group" CHECK ("wiki_pages"."group" IN ('start', 'world', 'ship', 'empire', 'war', 'people', 'lore', 'books'));