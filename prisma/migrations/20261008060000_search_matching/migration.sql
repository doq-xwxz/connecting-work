-- Derived FTS field is maintained by PostgreSQL, deliberately outside ORM inputs.
ALTER TABLE "Job" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('pg_catalog.simple'::regconfig, lower(normalize(coalesce("title", ''), NFC) COLLATE pg_catalog.pg_unicode_fast)), 'A') ||
  setweight(to_tsvector('pg_catalog.simple'::regconfig, lower(normalize(coalesce("description", ''), NFC) COLLATE pg_catalog.pg_unicode_fast)), 'B')
) STORED;
CREATE INDEX "Job_published_search_gin" ON "Job" USING GIN ("searchVector") WHERE "status" = 'PUBLISHED';

ALTER TABLE "Application"
  ADD COLUMN "matchEligibleAtApply" boolean,
  ADD COLUMN "matchScoreAtApply" integer,
  ADD COLUMN "matchCoverageAtApply" integer,
  ADD COLUMN "matchWeightsVersion" text,
  ADD COLUMN "matchAlgorithmVersion" text,
  ADD COLUMN "matchedAt" timestamp(3),
  ADD CONSTRAINT "Application_match_snapshot_valid" CHECK (
    ("matchEligibleAtApply" IS NULL AND "matchScoreAtApply" IS NULL AND "matchCoverageAtApply" IS NULL AND "matchWeightsVersion" IS NULL AND "matchAlgorithmVersion" IS NULL AND "matchedAt" IS NULL)
    OR ("matchEligibleAtApply" IS TRUE AND "matchScoreAtApply" IS NOT NULL AND "matchScoreAtApply" BETWEEN 0 AND 100
      AND "matchCoverageAtApply" IS NOT NULL AND "matchCoverageAtApply" BETWEEN 0 AND 100
      AND "matchWeightsVersion" IS NOT NULL AND length("matchWeightsVersion") BETWEEN 1 AND 40
      AND "matchAlgorithmVersion" IS NOT NULL AND length("matchAlgorithmVersion") BETWEEN 1 AND 80 AND "matchedAt" IS NOT NULL)
  );
CREATE FUNCTION protect_application_match_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."matchEligibleAtApply", NEW."matchScoreAtApply", NEW."matchCoverageAtApply", NEW."matchWeightsVersion", NEW."matchAlgorithmVersion", NEW."matchedAt")
    IS DISTINCT FROM ROW(OLD."matchEligibleAtApply", OLD."matchScoreAtApply", OLD."matchCoverageAtApply", OLD."matchWeightsVersion", OLD."matchAlgorithmVersion", OLD."matchedAt") THEN
    RAISE EXCEPTION 'Immutable application match snapshot';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Application_match_snapshot_immutable" BEFORE UPDATE ON "Application" FOR EACH ROW EXECUTE FUNCTION protect_application_match_snapshot();
