import { CompanyPage } from "@/modules/profiles/pages";
export default async function Page({ params, searchParams }: { params: Promise<{ companySlug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) { const [route, query] = await Promise.all([params, searchParams]); return <CompanyPage slug={route.companySlug} query={query} />; }
