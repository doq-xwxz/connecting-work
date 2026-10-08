import { RecommendationsPage } from "@/modules/matching/pages";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <RecommendationsPage query={await searchParams} />;
}
