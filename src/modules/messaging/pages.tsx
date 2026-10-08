import "server-only";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import type { Principal } from "@/modules/auth/policy";
import { requireAuthenticatedUser } from "@/modules/auth/principal";
import { MarketplaceNavigation } from "@/modules/profiles/pages";
import { getDb } from "@/shared/db/client";
import { AppError } from "@/shared/errors/app-error";
import { getConversation, listConversations, listMessages, listNotifications } from "./service";
import { Chat, NotificationRead } from "./components/chat";
import type { Side } from "./contracts";
type Query = Record<string, string | string[] | undefined>;
async function guarded(title: string, render: (actor: Principal) => Promise<ReactNode>) {
  let content: ReactNode;
  try { content = await render(await requireAuthenticatedUser(await headers())); }
  catch (error) {
    if (error instanceof AppError && error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (error instanceof AppError && error.code === "NOT_FOUND") notFound();
    content = <p>Không thể mở tin nhắn. Kiểm tra vai trò và quyền truy cập hiện tại.</p>;
  }
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><MarketplaceNavigation /><h1 className="text-3xl font-semibold">{title}</h1>{content}</main>;
}
export function MessagesPage({ side, query }: { side: Side; query: Query }) {
  return guarded("Tin nhắn", async (actor) => {
    const page = await listConversations(getDb(), actor, side, query); const root = `/${side.toLowerCase()}/messages`;
    return <><p>{page.unreadConversations} cuộc trao đổi / {page.unreadMessages} tin chưa đọc</p><ul className="space-y-4">{page.items.map((c) => <li key={c.id} className="rounded-md border p-4"><Link className="underline" href={`${root}/${c.id}`}>{c.jobTitle} · {c.counterpartyDisplay}</Link><p>{c.unread ? "Có tin chưa đọc" : "Đã đọc"} · {c.lastMessageAt ? new Date(c.lastMessageAt).toLocaleString("vi-VN") : "Chưa có tin"}</p></li>)}</ul>{!page.items.length && <p>Chưa có cuộc trao đổi. Mở tin nhắn từ chi tiết ứng tuyển.</p>}{page.nextCursor && <Link className="underline" href={`${root}?cursor=${page.nextCursor}`}>Trang tiếp</Link>}</>;
  });
}
export function ConversationPage({ side, id }: { side: Side; id: string }) {
  return guarded("Trao đổi công việc", async (actor) => {
    const conversation = await getConversation(getDb(), actor, side, id);
    const page = await listMessages(getDb(), actor, side, id, {});
    return <><Link className="underline" href={`/${side.toLowerCase()}/applications/${conversation.applicationId}`}>Hồ sơ ứng tuyển / công việc</Link><Chat key={id} initial={conversation} page={page} side={side} /></>;
  });
}
export function NotificationsPage({ query }: { query: Query }) {
  return guarded("Thông báo", async (actor) => {
    const page = await listNotifications(getDb(), actor, query);
    return <><ul className="space-y-4">{page.items.map((n) => <li key={n.id} className="rounded-md border p-4"><Link className="underline" href={n.href}>Tin nhắn mới · {n.jobTitle}</Link><p>{n.read ? "Đã đọc" : "Chưa đọc"}</p>{!n.read && <NotificationRead id={n.id} messageId={n.messageId} />}</li>)}</ul>{!page.items.length && <p>Chưa có thông báo.</p>}{page.nextCursor && <Link className="underline" href={`/notifications?cursor=${page.nextCursor}`}>Trang tiếp</Link>}</>;
  });
}
