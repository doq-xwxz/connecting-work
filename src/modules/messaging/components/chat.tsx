"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { getConversation, listMessages } from "../service";
import type { Side } from "../contracts";

type Conversation = Awaited<ReturnType<typeof getConversation>>;
type Page = Awaited<ReturnType<typeof listMessages>>;
const failure = "Không thể thực hiện. Kiểm tra quyền truy cập hoặc thử lại sau.";
async function request<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(failure);
  return response.json() as Promise<T>;
}
export function OpenConversation({ side, applicationId }: { side: Side; applicationId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  return <div><button className="rounded-md border px-4 py-2" disabled={busy} onClick={async () => {
    setBusy(true); setError("");
    try { const conversation = await request<Conversation>(`/api/marketplace/${side.toLowerCase()}-applications/${applicationId}/conversation`, {}); router.push(`/${side.toLowerCase()}/messages/${conversation.id}`); }
    catch { setError(failure); } finally { setBusy(false); }
  }}>Mở tin nhắn</button><p role="status">{error}</p></div>;
}
export function Chat({ side, initial, page }: { side: Side; initial: Conversation; page: Page }) {
  const root = `/api/marketplace/${side.toLowerCase()}-conversations/${initial.id}`;
  const [conversation, setConversation] = useState(initial); const [items, setItems] = useState(page.items);
  const [hasOlder, setHasOlder] = useState(page.hasMore); const [older, setOlder] = useState(false);
  const [body, setBody] = useState(""); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const position = useRef(page.newest); const pending = useRef<{ body: string; key: string } | null>(null);
  const active = useRef(false); const initialRead = useRef(page.newest);
  useEffect(() => {
    const controller = new AbortController(); let stopped = false;
    async function poll() {
      if (stopped || active.current || document.visibilityState !== "visible" || older) return;
      active.current = true;
      try {
        const current = await request<Conversation>(root, undefined, controller.signal);
        const next = await request<Page>(`${root}/messages${position.current ? `?after=${position.current}` : ""}`, undefined, controller.signal);
        if (stopped) return;
        setConversation(current);
        setItems((old) => Array.from(new Map([...old, ...next.items].map((m) => [m.id, m])).values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : 1)).slice(-200));
        if (next.newest) position.current = next.newest;
        const read = next.newest ?? initialRead.current;
        if (read) await request(`${root}/read`, { messageId: read }, controller.signal);
        initialRead.current = null;
      } catch { if (!stopped && !controller.signal.aborted) { setFeedback(failure); setUnavailable(true); } }
      finally { active.current = false; }
    }
    void poll(); const timer = setInterval(() => { void poll(); }, 8000);
    return () => { stopped = true; clearInterval(timer); controller.abort(); };
  }, [root, older]);
  async function history(recent: boolean) {
    if (active.current || busy) return; active.current = true; setBusy(true); setFeedback("");
    try {
      const next = await request<Page>(`${root}/messages${recent ? "" : `?before=${items[0]?.id}`}`);
      setItems(next.items); setHasOlder(next.hasMore); setOlder(!recent);
      if (recent) position.current = next.newest;
    } catch { setFeedback(failure); } finally { active.current = false; setBusy(false); }
  }
  if (unavailable) return <p role="alert">{failure} Tải lại trang để kiểm tra quyền hiện tại.</p>;
  return <section className="space-y-4"><p>{conversation.company ?? conversation.counterpartyDisplay} · {conversation.job.title}</p>
    <p>{conversation.messagingAllowed ? "Có thể trao đổi trong hồ sơ này." : `Lịch sử chỉ đọc: ${conversation.disabledReason}`}</p>
    <div className="flex gap-4"><button className="underline" disabled={(!hasOlder && items.length < 200) || busy || !items.length} onClick={() => void history(false)}>Tin cũ hơn</button>{older && <button className="underline" disabled={busy} onClick={() => void history(true)}>Về tin mới / tiếp tục cập nhật</button>}</div>
    {older && <p>Đang xem lịch sử; tự cập nhật tạm dừng.</p>}
    <ol className="space-y-4" aria-label="Tin nhắn">{items.map((message) => <li className="rounded-md border p-4" key={message.id}>
      <p className="text-sm">{message.senderDisplay} · {message.senderSide === "WORKER" ? "Người tìm việc" : "Người thuê"} · <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString("vi-VN")}</time></p>
      <p className="whitespace-pre-wrap break-words">{message.body}</p>
      {!message.own && message.senderSide !== side && <div className="mt-2 flex gap-4 text-sm">{[true, false].map((blocked) => <button className="underline" disabled={busy} key={String(blocked)} onClick={async () => {
        setBusy(true); try { await request(`${root}/block`, { messageId: message.id, blocked }); setConversation(await request<Conversation>(root)); setFeedback(blocked ? "Đã chặn liên hệ mới. Công việc đang hoạt động vẫn giữ quyền trao đổi." : "Đã bỏ chặn từ phía bạn."); }
        catch { setFeedback(failure); } finally { setBusy(false); }
      }}>{blocked ? "Chặn người gửi" : "Bỏ chặn người gửi"}</button>)}</div>}
    </li>)}</ol>
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault(); if (busy || older) return; setBusy(true); setFeedback("");
      if (!pending.current || pending.current.body !== body) pending.current = { body, key: crypto.randomUUID() };
      try {
        const message = await request<Page["items"][number]>(`${root}/messages`, { body, creationKey: pending.current.key });
        setItems((old) => Array.from(new Map([...old, message].map((m) => [m.id, m])).values()).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.id < b.id ? -1 : 1)).slice(-200));
        // Forward cursor advances only through polling, so concurrent incoming
        // messages between its old position and this send cannot be skipped.
        setBody(""); pending.current = null; setFeedback("Đã gửi.");
      } catch { setFeedback(failure); } finally { setBusy(false); }
    }}><label className="block" htmlFor="message-body">Tin nhắn (tối đa 4.000 ký tự)</label><textarea className="w-full rounded-md border p-3" id="message-body" maxLength={4000} required value={body} onChange={(e) => setBody(e.target.value)} disabled={busy || !conversation.messagingAllowed || older} />
      <button className="rounded-md border px-4 py-2" disabled={busy || !conversation.messagingAllowed || older}>Gửi tin nhắn</button></form><p role="status">{feedback}</p>
  </section>;
}
export function NotificationRead({ id, messageId }: { id: string; messageId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState("");
  return <><button disabled={busy} className="underline" onClick={async () => { setBusy(true); try { await request(`/api/marketplace/notifications/${id}/read`, { messageId }); router.refresh(); } catch { setFeedback(failure); } finally { setBusy(false); } }}>Đánh dấu đã đọc</button><p role="status">{feedback}</p></>;
}
