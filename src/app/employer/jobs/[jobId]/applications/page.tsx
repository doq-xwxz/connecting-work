import { ApplicationsPage } from "@/modules/hiring/pages";
export default async function Page({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ApplicationsPage side="EMPLOYER" jobId={(await params).jobId} query={await searchParams} />;
}
