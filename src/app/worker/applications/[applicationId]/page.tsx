import { ApplicationPage } from "@/modules/hiring/pages";
export default async function Page({ params, searchParams }: { params: Promise<{ applicationId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ApplicationPage side="WORKER" id={(await params).applicationId} query={await searchParams} />;
}
