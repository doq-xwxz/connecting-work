import { JobNewPage } from "@/modules/jobs/pages";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <JobNewPage query={await searchParams} />; }
