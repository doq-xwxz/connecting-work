import { OwnReportsPage } from "@/modules/moderation/pages";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <OwnReportsPage query={await searchParams} />; }
