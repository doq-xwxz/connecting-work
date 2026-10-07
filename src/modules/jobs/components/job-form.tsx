"use client";
import { useRef, useState } from "react";
import type { CompanyManagement } from "@/modules/companies/contracts";
import { Feedback, Field, inputClass, useMutation } from "@/modules/profiles/components/form-parts";
import { levels, preferences, workModes } from "@/modules/profiles/contracts";
import { categories, compensationTypes, type JobInput, type ManagedJob } from "../contracts";

export function JobForm({ job, skills, companies = [], active }: { job?: ManagedJob; skills: { id: string; name: string }[]; companies?: CompanyManagement[]; active: boolean }) {
  const [slots, setSlots] = useState<JobInput["schedule"]>(job?.schedule ?? []);
  const creationKey = useRef<string | null>(null);
  const { busy, message, mutate } = useMutation();
  const editable = !job || ["DRAFT", "PUBLISHED", "PAUSED"].includes(job.status);
  const days = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
  return <form className="space-y-5" onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); creationKey.current ??= crypto.randomUUID();
    const chosen = skills.flatMap((skill) => data.get(`skill-${skill.id}`) ? [{ skillId: skill.id, minimumLevel: data.get(`level-${skill.id}`), required: data.get(`required-${skill.id}`) === "on" }] : []);
    void mutate(job ? `employer-jobs/${job.id}` : "employer-jobs", job ? "PUT" : "POST", {
      title: data.get("title"), description: data.get("description"), category: data.get("category") || null,
      employmentType: data.get("employmentType") || null, workMode: data.get("workMode") || null, city: data.get("city") || null,
      compensationType: data.get("compensationType") || null, compensationMin: data.get("compensationMin") || null, compensationMax: data.get("compensationMax") || null,
      currency: "VND", headcount: Number(data.get("headcount")), startDate: data.get("startDate") || null, endDate: data.get("endDate") || null,
      timezone: data.get("timezone"), skills: chosen, schedule: slots,
      ...(job ? { expectedVersion: job.version } : { companyId: data.get("companyId") || null, creationKey: creationKey.current }),
    }, job ? `/employer/jobs/${job.id}` : "/employer/jobs");
  }}><fieldset disabled={busy || !active || !editable} className="space-y-5"><legend className="sr-only">Nội dung tin tuyển dụng</legend>
    {!job && <Field label="Chủ thể tuyển dụng"><select className={inputClass} name="companyId"><option value="">Cá nhân</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name} · {company.role}</option>)}</select></Field>}
    <Field label="Tiêu đề"><input className={inputClass} name="title" maxLength={160} defaultValue={job?.title ?? ""} /></Field>
    <Field label="Mô tả"><textarea className={inputClass} name="description" rows={5} maxLength={6000} defaultValue={job?.description ?? ""} /></Field>
    <Field label="Nhóm công việc"><select className={inputClass} name="category" defaultValue={job?.category ?? ""}><option value="">Chưa chọn</option>{categories.map((category) => <option key={category}>{category}</option>)}</select></Field>
    <Field label="Loại công việc"><select className={inputClass} name="employmentType" defaultValue={job?.employmentType ?? ""}><option value="">Chưa chọn</option>{preferences.map((type) => <option key={type}>{type}</option>)}</select></Field>
    <Field label="Hình thức làm việc"><select className={inputClass} name="workMode" defaultValue={job?.workMode ?? ""}><option value="">Chưa chọn</option>{workModes.map((mode) => <option key={mode}>{mode}</option>)}</select></Field>
    <Field label="Tỉnh/thành phố (không nhập địa chỉ riêng)"><input className={inputClass} name="city" maxLength={80} defaultValue={job?.city ?? ""} /></Field>
    <Field label="Đơn vị thu nhập"><select className={inputClass} name="compensationType" defaultValue={job?.compensationType ?? ""}><option value="">Chưa chọn</option>{compensationTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
    <p className="text-sm">Đơn vị tiền VND, nhập số đồng nguyên. Mức cố định: nhập hai ô bằng nhau. Tin phải có thu nhập rõ ràng trước khi đăng.</p>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Thu nhập thấp nhất (VND)"><input className={inputClass} name="compensationMin" inputMode="numeric" pattern="[0-9]*" maxLength={13} defaultValue={job?.compensationMin ?? ""} /></Field>
      <Field label="Thu nhập cao nhất (VND)"><input className={inputClass} name="compensationMax" inputMode="numeric" pattern="[0-9]*" maxLength={13} defaultValue={job?.compensationMax ?? ""} /></Field></div>
    <Field label="Số người cần tuyển"><input className={inputClass} name="headcount" type="number" min={1} max={1000} step={1} required defaultValue={job?.headcount ?? 1} /></Field>
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Ngày bắt đầu"><input className={inputClass} name="startDate" type="date" min="2000-01-01" max="2100-12-31" defaultValue={job?.startDate ?? ""} /></Field>
      <Field label="Ngày kết thúc"><input className={inputClass} name="endDate" type="date" min="2000-01-01" max="2100-12-31" defaultValue={job?.endDate ?? ""} /></Field></div>
    <fieldset className="space-y-3"><legend className="font-medium">Kỹ năng yêu cầu / ưu tiên</legend>{skills.map((skill) => {
      const selected = job?.skills.find((item) => item.skillId === skill.id);
      return <div key={skill.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3"><label><input name={`skill-${skill.id}`} type="checkbox" defaultChecked={Boolean(selected)} /> {skill.name}</label>
        <label>Cấp tối thiểu <select className="rounded-md border p-1" name={`level-${skill.id}`} defaultValue={selected?.minimumLevel ?? "BEGINNER"}>{levels.map((level) => <option key={level}>{level}</option>)}</select></label>
        <label><input type="checkbox" name={`required-${skill.id}`} defaultChecked={selected?.required ?? true} /> Bắt buộc</label></div>;
    })}</fieldset>
    <Field label="Múi giờ IANA"><input className={inputClass} name="timezone" required maxLength={80} defaultValue={job?.timezone ?? "Asia/Ho_Chi_Minh"} /></Field>
    <fieldset className="space-y-3"><legend className="font-medium">Lịch tuần</legend><p className="text-sm">PART_TIME, TEMPORARY, SHIFT cần khung giờ để đăng tin. Giờ nguyên 0–24; lịch qua đêm tách thành hai ngày.</p>
      {slots.map((slot, index) => <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label>Ngày<select className={inputClass} value={slot.weekday} onChange={(event) => setSlots((current) => current.map((item, i) => i === index ? { ...item, weekday: Number(event.target.value) } : item))}>{days.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label>
        <label>Bắt đầu<input className={inputClass} type="number" min={0} max={23} step={1} value={slot.startHour} onChange={(event) => setSlots((current) => current.map((item, i) => i === index ? { ...item, startHour: Number(event.target.value) } : item))} /></label>
        <label>Kết thúc<input className={inputClass} type="number" min={1} max={24} step={1} value={slot.endHour} onChange={(event) => setSlots((current) => current.map((item, i) => i === index ? { ...item, endHour: Number(event.target.value) } : item))} /></label>
        <button className="self-end rounded-md border px-3 py-2" type="button" onClick={() => setSlots((current) => current.filter((_, i) => i !== index))}>Xóa lịch {index + 1}</button></div>)}
      <button className="rounded-md border px-3 py-2" type="button" disabled={slots.length >= 14} onClick={() => setSlots((current) => [...current, { weekday: 1, startHour: 9, endHour: 17 }])}>Thêm khung giờ</button>
    </fieldset>
    <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">{busy ? "Đang lưu…" : job ? "Lưu nội dung" : "Tạo bản nháp"}</button>
  </fieldset>{!active && <p>Tài khoản hiện chỉ được đọc và thực hiện thao tác giảm hiển thị được phép.</p>}{!editable && <p>Tin đã kết thúc. Dùng chức năng nhân bản để tuyển lại.</p>}<Feedback message={message} /></form>;
}
