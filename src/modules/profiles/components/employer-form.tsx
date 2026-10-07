"use client";
import { employerTypes, type EmployerSelf } from "../contracts";
import { Feedback, Field, inputClass, useMutation } from "./form-parts";
export function EmployerForm({ profile, active }: { profile: EmployerSelf | null; active: boolean }) {
  const { busy, message, mutate } = useMutation();
  return <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget);
    void mutate(profile ? `employer/${profile.id}` : "employer", profile ? "PUT" : "POST", {
      type: data.get("type"), description: data.get("description"), city: data.get("city") || null,
    }, "/employer/profile");
  }}><fieldset disabled={busy || !active} className="space-y-5"><legend className="sr-only">Hồ sơ người thuê cá nhân</legend>
    <Field label="Loại người thuê"><select className={inputClass} name="type" defaultValue={profile?.type ?? "INDIVIDUAL"}>{employerTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
    <Field label="Tỉnh/thành phố"><input className={inputClass} name="city" maxLength={80} defaultValue={profile?.city ?? ""} /></Field>
    <Field label="Giới thiệu"><textarea className={inputClass} name="description" maxLength={1000} defaultValue={profile?.description ?? ""} /></Field>
    <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">{busy ? "Đang lưu…" : "Lưu hồ sơ người thuê"}</button>
  </fieldset><Feedback message={message} /></form>;
}
