-- AddColumn: soft-delete support for articles
ALTER TABLE "articles" ADD COLUMN "deleted_at" TIMESTAMP(3);
