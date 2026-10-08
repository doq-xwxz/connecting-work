import { MessagesPage } from "@/modules/messaging/pages";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <MessagesPage side="WORKER" query={await searchParams} />;
}
