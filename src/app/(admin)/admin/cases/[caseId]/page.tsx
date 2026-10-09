import { CasePage } from "@/modules/moderation/pages";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Page({ params, searchParams }: { params: Promise<{ caseId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <CasePage id={(await params).caseId} query={await searchParams} />; }
