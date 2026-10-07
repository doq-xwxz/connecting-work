"use client";
import { useState } from "react";
import { levels, preferences, workModes, type WorkerInput, type WorkerSelf } from "../contracts";
import { Feedback, Field, inputClass, useMutation } from "./form-parts";

export function WorkerForm({ profile, skills, active }: { profile: WorkerSelf | null; skills: { id: string; name: string; category: string }[]; active: boolean }) {
  const [slots, setSlots] = useState<WorkerInput["availability"]>(profile?.availability ?? []);
  const { busy, message, mutate } = useMutation();
  const days = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];
  return <div className="space-y-6">
    {profile && <div className="rounded-md border p-4"><p>Hoàn thiện hồ sơ: {profile.completeness.percentage}% — {profile.completeness.complete ? "Đủ thông tin tối thiểu" : "Còn thiếu thông tin"}</p>
      <p className="mt-2 text-sm">Đây là mức hoàn thiện hồ sơ, không phải Match Score.</p>
      <p className="mt-2">Hiển thị với người thuê: {profile.discoverable ? "Đã bật" : "Đang tắt"}</p>
      <button type="button" className="mt-3 rounded-md border px-3 py-2 disabled:opacity-50" disabled={busy || (!active && !profile.discoverable)}
        onClick={() => mutate(`worker/${profile.id}/discoverability`, "PATCH", { discoverable: !profile.discoverable })}>{profile.discoverable ? "Ẩn khỏi tìm kiếm người thuê" : "Cho phép người thuê tìm thấy tôi"}</button>
      <p className="mt-2 text-sm">Chỉ người thuê đã đăng nhập và tạo hồ sơ mới thấy thông tin tổng quát. Email và lịch chi tiết không được hiển thị.</p></div>}
    <form className="space-y-5" onSubmit={(event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const selectedSkills = skills.flatMap((skill) => { const level = data.get(`skill-${skill.id}`); return level ? [{ skillId: skill.id, level }] : []; });
      void mutate(profile ? `worker/${profile.id}` : "worker", profile ? "PUT" : "POST", {
        headline: data.get("headline"), city: data.get("city") || null, bio: data.get("bio"), timezone: data.get("timezone"),
        preferences: data.getAll("preferences"), workModes: data.getAll("workModes"), skills: selectedSkills, availability: slots,
      }, "/worker/profile");
    }}>
      <fieldset disabled={busy || !active} className="space-y-5">
        <legend className="sr-only">Thông tin hồ sơ người tìm việc</legend>
        <Field label="Tiêu đề hồ sơ"><input className={inputClass} name="headline" maxLength={160} defaultValue={profile?.headline ?? ""} /></Field>
        <Field label="Tỉnh/thành phố (không nhập địa chỉ nhà)"><input className={inputClass} name="city" maxLength={80} defaultValue={profile?.city ?? ""} /></Field>
        <Field label="Giới thiệu"><textarea className={inputClass} name="bio" maxLength={1000} defaultValue={profile?.bio ?? ""} /></Field>
        <fieldset><legend className="font-medium">Hình thức làm việc</legend><div className="mt-2 flex flex-wrap gap-4">{workModes.map((mode) => <label key={mode} className="flex gap-2"><input type="checkbox" name="workModes" value={mode} defaultChecked={profile?.workModes.includes(mode)} />{mode === "ON_SITE" ? "Tại nơi làm" : mode === "REMOTE" ? "Từ xa" : "Kết hợp"}</label>)}</div></fieldset>
        <fieldset><legend className="font-medium">Loại công việc mong muốn</legend><div className="mt-2 flex flex-wrap gap-4">{preferences.map((preference) => <label key={preference} className="flex gap-2"><input type="checkbox" name="preferences" value={preference} defaultChecked={profile?.preferences.includes(preference)} />{preference}</label>)}</div></fieldset>
        <fieldset className="space-y-3"><legend className="font-medium">Kỹ năng</legend>{skills.map((skill) => <Field key={skill.id} label={`${skill.name} · ${skill.category}`}><select className={inputClass} name={`skill-${skill.id}`} defaultValue={profile?.skills.find((item) => item.skillId === skill.id)?.level ?? ""}><option value="">Chưa chọn</option>{levels.map((level) => <option key={level}>{level}</option>)}</select></Field>)}</fieldset>
        <Field label="Múi giờ IANA của lịch tuần"><input className={inputClass} name="timezone" defaultValue={profile?.timezone ?? "Asia/Ho_Chi_Minh"} required maxLength={80} /></Field>
        <fieldset className="space-y-3"><legend className="font-medium">Khung giờ có thể làm mỗi tuần</legend><p className="text-sm">Cần có lịch cho PART_TIME, TEMPORARY hoặc SHIFT. Khung giờ cùng ngày không được chồng lấn; giờ kết thúc 24 nghĩa là hết ngày.</p>
          {slots.map((slot, index) => <div key={index} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="text-sm">Ngày<select className={inputClass} value={slot.weekday} onChange={(event) => setSlots(slots.map((item, i) => i === index ? { ...item, weekday: Number(event.target.value) } : item))}>{days.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label>
            <label className="text-sm">Bắt đầu<input className={inputClass} type="number" min={0} max={23} step={1} value={slot.startHour} onChange={(event) => setSlots(slots.map((item, i) => i === index ? { ...item, startHour: Number(event.target.value) } : item))} /></label>
            <label className="text-sm">Kết thúc<input className={inputClass} type="number" min={1} max={24} step={1} value={slot.endHour} onChange={(event) => setSlots(slots.map((item, i) => i === index ? { ...item, endHour: Number(event.target.value) } : item))} /></label>
            <button type="button" className="self-end rounded-md border px-3 py-2" onClick={() => setSlots(slots.filter((_, i) => i !== index))}>Xóa khung giờ {index + 1}</button></div>)}
          <button type="button" className="rounded-md border px-3 py-2 disabled:opacity-50" disabled={slots.length >= 14} onClick={() => setSlots([...slots, { weekday: 1, startHour: 9, endHour: 17 }])}>Thêm khung giờ</button>
        </fieldset>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50" disabled={busy}>{busy ? "Đang lưu…" : profile ? "Lưu hồ sơ" : "Tạo hồ sơ"}</button>
      </fieldset>
    </form>
    {!active && <p>Tài khoản hiện không được tạo hoặc sửa hoạt động marketplace. Bạn vẫn có thể tắt hiển thị hồ sơ.</p>}
    <Feedback message={message} />
  </div>;
}
