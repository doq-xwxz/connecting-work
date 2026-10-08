import { NotificationsPage } from "@/modules/messaging/pages";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <NotificationsPage query={await searchParams} />;
}
