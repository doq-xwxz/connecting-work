import { ApplicationsPage } from "@/modules/hiring/pages";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <ApplicationsPage side="WORKER" query={await searchParams} />;
}
