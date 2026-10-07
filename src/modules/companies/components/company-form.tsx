"use client";
import { useRef } from "react";
import type { CompanyManagement, CompanyMemberDto } from "../contracts";
import { Feedback, Field, inputClass, useMutation } from "@/modules/profiles/components/form-parts";
export function CompanyForm({ company, active }: { company?: CompanyManagement; active: boolean }) {
  const creationKey = useRef<string | null>(null);
  const { busy, message, mutate } = useMutation();
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget);
    creationKey.current ??= crypto.randomUUID();
    void mutate(company ? `company/${company.id}` : "companies", company ? "PUT" : "POST", {
      name: data.get("name"), description: data.get("description"), city: data.get("city") || null, website: data.get("website") || null,
      ...(!company ? { creationKey: creationKey.current } : {}),
    }, "/employer/companies");
  }}><fieldset disabled={busy || !active} className="space-y-5"><legend className="sr-only">Thông tin công ty</legend>
    <Field label="Tên công ty"><input className={inputClass} name="name" required minLength={2} maxLength={120} defaultValue={company?.name ?? ""} /></Field>
    <Field label="Tỉnh/thành phố"><input className={inputClass} name="city" maxLength={80} defaultValue={company?.city ?? ""} /></Field>
    <Field label="Website (http hoặc https)"><input className={inputClass} name="website" type="url" maxLength={300} defaultValue={company?.website ?? ""} /></Field>
    <Field label="Giới thiệu"><textarea className={inputClass} name="description" maxLength={1000} defaultValue={company?.description ?? ""} /></Field>
    <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">{busy ? "Đang lưu…" : company ? "Lưu công ty" : "Tạo công ty"}</button>
  </fieldset><p className="text-sm">Công ty mới chưa được xác minh. Chủ sở hữu được ghi nhận khi tạo công ty.</p><Feedback message={message} /></form>;
}
export function MemberControls({ companyId, members, active }: { companyId: string; members: CompanyMemberDto[]; active: boolean }) {
  const { busy, message, mutate } = useMutation();
  return <section className="mt-8 space-y-3"><h2 className="text-xl font-semibold">Thành viên hiện tại</h2>
    <ul className="space-y-3">{members.map((member) => <li key={member.memberId} className="flex flex-wrap items-center gap-3"><span>{member.displayName} · {member.role}</span>
      {member.role === "MANAGER" && <button disabled={busy || !active} className="rounded-md border px-3 py-2 disabled:opacity-50" onClick={() => mutate(`company/${companyId}/members/${member.memberId}`, "DELETE", {})}>Gỡ MANAGER</button>}</li>)}</ul>
    <p className="text-sm">Mời thành viên và chuyển chủ sở hữu sẽ có luồng riêng ở giai đoạn sau.</p><Feedback message={message} />
  </section>;
}
