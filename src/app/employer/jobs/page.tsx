import { JobsManagementPage } from "@/modules/jobs/pages";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <JobsManagementPage query={await searchParams} />; }
