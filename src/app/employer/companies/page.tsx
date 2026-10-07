import { CompaniesPage } from "@/modules/profiles/pages";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <CompaniesPage query={await searchParams} />; }
