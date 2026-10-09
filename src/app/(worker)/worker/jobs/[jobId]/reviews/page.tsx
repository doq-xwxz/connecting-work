import { ReviewsPage } from "@/modules/reviews/pages";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function Page({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ReviewsPage jobId={(await params).jobId} query={await searchParams} />;
}
