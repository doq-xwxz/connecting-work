import { RecommendationsPage } from "@/modules/matching/pages";
export default async function Page({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <RecommendationsPage jobId={(await params).jobId} query={await searchParams} />;
}
