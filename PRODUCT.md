# PRODUCT SPEC V1

## 1. Tầm nhìn sản phẩm

Xây dựng một nền tảng kết nối trực tiếp giữa:

- Người/công ty có nhu cầu thuê người làm việc.
- Người lao động đang tìm kiếm cơ hội làm việc phù hợp.

Sản phẩm không chỉ đóng vai trò là website đăng tin tuyển dụng mà hướng tới mô hình **job marketplace**, trong đó hệ thống hỗ trợ toàn bộ chu trình:

Đăng nhu cầu → tìm người phù hợp → ứng tuyển/đề nghị → trao đổi → nhận việc → hoàn thành → đánh giá.

Mục tiêu dài hạn là trở thành nơi người dùng có thể tìm người làm hoặc tìm việc nhanh tương tự cách marketplace kết nối cung và cầu.

---

# 2. Vấn đề cần giải quyết

## 2.1. Đối với người tìm việc

Hiện nay người tìm việc thường gặp:

- Tin tuyển dụng không rõ mức lương.
- Mô tả công việc chung chung.
- Phải nộp CV cho rất nhiều công việc.
- Không biết khả năng được tuyển.
- Không biết nhà tuyển dụng có uy tín hay không.
- Nhiều công việc part-time/freelance nằm rải rác trên Facebook, Telegram, Zalo và các hội nhóm.
- Khó tìm công việc phù hợp với thời gian rảnh.
- Nhà tuyển dụng không phản hồi sau khi ứng tuyển.

Sản phẩm cần giúp người lao động nhanh chóng trả lời:

> Việc nào phù hợp với tôi?

> Thu nhập bao nhiêu?

> Làm ở đâu?

> Làm khi nào?

> Người thuê có đáng tin không?

> Công việc này phù hợp với hồ sơ của tôi ở mức nào? Match Score không phải xác suất được tuyển.

---

# 3. Vấn đề của người thuê

Người thuê thường gặp:

- Đăng bài vào nhiều group.
- Nhận hàng chục inbox không phù hợp.
- Khó đánh giá ứng viên.
- Người nhận việc rồi hủy.
- Người làm không đến.
- Freelancer biến mất giữa dự án.
- Khó tìm người trong thời gian ngắn.
- Không có lịch sử uy tín của người lao động.

Sản phẩm cần giúp họ:

> Đăng nhu cầu trong vài phút.

> Nhận danh sách người phù hợp.

> So sánh ứng viên.

> Chat trực tiếp.

> Gửi offer.

> Theo dõi tình trạng công việc.

> Đánh giá người lao động sau khi hoàn thành.

---

# 4. Định vị sản phẩm

Không định vị là:

> Website tuyển dụng giống TopCV.

Mà định vị là:

> Marketplace kết nối nhu cầu làm việc và nhu cầu thuê người.

Điểm khác biệt chính:

### 4.1. Công việc có cấu trúc

Mỗi công việc có:

- Công việc gì.
- Khi nào làm.
- Làm trong bao lâu.
- Ở đâu.
- Làm online hay offline.
- Thu nhập bao nhiêu.
- Cần kỹ năng gì.
- Cần bao nhiêu người.

### 4.2. Worker profile có cấu trúc

Không phụ thuộc hoàn toàn vào CV.

Hệ thống hiểu:

- Kỹ năng.
- Kinh nghiệm.
- Thời gian rảnh.
- Khu vực có thể làm.
- Thu nhập kỳ vọng.
- Lịch sử công việc.
- Rating.

### 4.3. Matching

Hệ thống đề xuất:

> Công việc phù hợp với bạn.

và:

> Người phù hợp với công việc này.

### 4.4. Reputation

Cả hai phía đều có:

- Rating.
- Reviews.
- Completion rate.
- Response rate.
- Verification.

---

# 5. Thị trường đầu tiên

Không launch cho mọi loại công việc.

V1 tập trung:

### Nhóm 1 — Admin / Operations

Ví dụ:

- Nhập dữ liệu.
- Hỗ trợ văn phòng.
- Data entry.
- Event support.
- Inventory count.
- Documentation.

### Nhóm 2 — Finance / Accounting

- Nhập hóa đơn.
- Đối chiếu dữ liệu.
- Bookkeeping support.
- Excel processing.
- Temporary accounting support.

### Nhóm 3 — Marketing

- Content.
- Social media.
- Livestream assistant.
- Event staff.
- Activation.

### Nhóm 4 — Creative

- Graphic design.
- Video editing.
- Photography.
- Presentation design.

### Nhóm 5 — General part-time

- PG/PB.
- Event helper.
- Shop assistant.
- Temporary staff.

Không tập trung ngay vào:

- Senior management.
- Executive recruitment.
- Headhunting.
- C-level recruitment.

---

# 6. Các loại công việc

Hệ thống phải hỗ trợ:

FULL_TIME

PART_TIME

TEMPORARY

FREELANCE

PROJECT

SHIFT

INTERNSHIP

Có thể mở rộng sau này.

---

# 7. Các loại người dùng

Một User thông thường có thể đồng thời có WorkerProfile và EmployerProfile; WORKER và EMPLOYER được cùng tồn tại. ADMIN là vai trò/tài khoản vận hành, không được tự cấp qua signup hoặc client input.

## 7.1. Worker

Người tìm việc.

Có thể:

- Tạo profile.
- Chọn skills.
- Đặt availability.
- Đặt expected rate.
- Search jobs.
- Save jobs.
- Apply.
- Chat.
- Nhận offer.
- Accept/reject offer.
- Theo dõi công việc.
- Đánh giá employer.

---

## 7.2. Employer

Người thuê.

Có thể là:

- Cá nhân.
- Shop.
- Startup.
- SME.
- Company.
- Agency.

Employer có thể:

- Tạo company/profile.
- Đăng job.
- Quản lý job.
- Xem applicant.
- Xem suggested workers.
- Shortlist.
- Reject.
- Chat.
- Send offer.
- Confirm completion.
- Review worker.

---

## 7.3. Admin

Admin có quyền:

- View users.
- View jobs.
- Review reports.
- Hide job.
- Suspend user.
- Ban user.
- Verify employer.
- Verify worker.
- View system statistics.
- View audit logs.
- Xử lý tranh chấp/đối tác không phản hồi: FORCE_COMPLETE hoặc FORCE_CANCEL Engagement theo case cụ thể, bắt buộc reason, admin actor, timestamp và audit record bất biến.

---

# 8. Worker Profile

Worker profile V1 gồm:

Điều kiện tối thiểu để apply: name, headline, city hoặc Remote, work preference và ít nhất một skill. PART_TIME, TEMPORARY, SHIFT yêu cầu thêm availability. Không yêu cầu hoặc hỗ trợ CV upload trong MVP V1.

Không có public Worker directory. Worker chọn discoverable=true/false; chỉ Employer đã đăng nhập được discovery worker opted-in. Discovery có thể hiển thị coarse location, skills, headline, rating và availability summary; không email, phone, exact home address, raw availability hoặc private/account metadata. Expected compensation hiển thị theo privacy preference; có thể dùng server-side matching khi được phép.

## Basic Information

- Name.
- Avatar.
- Headline.
- Bio.
- City.
- District.
- Work preference.

## Skills

Ví dụ:

- Excel.
- Accounting.
- Photoshop.
- Canva.
- Sales.
- English.
- Event operations.

Mỗi skill có thể có level:

BEGINNER

INTERMEDIATE

ADVANCED

EXPERT

## Experience

- Company.
- Position.
- Start date.
- End date.
- Description.

## Education

- School.
- Major.
- Degree.

## Availability

Ví dụ:

Monday:
18:00–22:00

Saturday:
08:00–18:00

Sunday:
Available.

## Compensation

- Expected hourly rate.
- Expected daily rate.
- Expected monthly salary.

## Work preferences

- On-site.
- Remote.
- Hybrid.

## Location preference

Ví dụ:

- District 1.
- District 3.
- Bình Thạnh.
- Remote.

---

# 9. Employer Profile

Employer gồm:

- Name.
- Employer type.
- Company name.
- Logo.
- Description.
- Industry.
- Company size.
- Location.
- Website.
- Verification status.
- Rating.
- Number of completed hires.

---

# 10. Job Object

Một job gồm:

Ownership: job thuộc EmployerProfile cá nhân hoặc Company. Nếu companyId có giá trị, Company sở hữu job, kể cả khi người tạo rời công ty. Membership V1 chỉ OWNER và MANAGER; chưa có enterprise permissions chi tiết.

## Basic

job_id

title

description

category

employment_type

work_mode

location

## Timing

start_date

end_date

working_hours

estimated_duration

## Compensation

compensation_type

HOURLY

DAILY

PROJECT

MONTHLY

compensation_min

compensation_max

currency

## Requirements

skills

experience_level

education_requirement

language

## Operational

headcount

application_deadline

urgency

status

---

# 11. Job Status

DRAFT

PUBLISHED

PAUSED

CLOSED

COMPLETED

CANCELLED

Không xóa job trực tiếp khỏi database.

Dùng status.

COMPLETED và CANCELLED là terminal. CLOSED không reopen V1, không nhận application mới; employer có thể duplicate thành job mới để tuyển lại. Pending offers hợp lệ vẫn được accept sau CLOSED đến expiry, trừ khi job CANCELLED hoặc COMPLETED và vẫn phải đáp ứng eligibility/capacity/restrictions.

Sau application đầu tiên, không sửa material terms tại chỗ: compensation, work location, employment type, start/end dates, working schedule, và headcount nếu giảm dưới occupied slots. Material changes yêu cầu close/duplicate; non-material description wording được sửa. Accepted Offer/Engagement terms là immutable snapshots.

---

# 12. Application / Offer / Engagement Workflow

Application là recruitment intent: APPLIED → VIEWED → SHORTLISTED → OFFERED → ACCEPTED; nhánh REJECTED, WITHDRAWN, CANCELLED. IN_PROGRESS và COMPLETED không phải Application states.

Offer lưu immutable terms, statuses PENDING, ACCEPTED, DECLINED, REVOKED, EXPIRED. Đổi terms tạo revision mới; chỉ một PENDING Offer mỗi Application. DECLINED/REVOKED/EXPIRED đưa Application còn trong bước OFFERED về SHORTLISTED; employer có thể gửi offer khác. Withdrawal/cancellation của Application vẫn là terminal, không bị offer cleanup mở lại.

Accept phải recheck worker eligibility, job state, expiry, remaining headcount và account restrictions. Acceptance và tạo Engagement là atomic, không vượt headcount khi cạnh tranh đồng thời.

Engagement là quan hệ làm việc: ACCEPTED → IN_PROGRESS → COMPLETED. ACCEPTED hoặc IN_PROGRESS có thể CANCELLED. Employer confirms start; Worker requests completion; Employer confirms completion. Không auto-complete chỉ theo thời gian. Admin case-bound FORCE_COMPLETE/FORCE_CANCEL theo §7.3 khi có dispute/unresponsive counterparty.

Occupied headcount gồm Engagement ACCEPTED, IN_PROGRESS, COMPLETED; CANCELLED không chiếm slot.

---
# 13. Các rule quan trọng

Worker không được:

- Apply cùng một jobId hai lần trong suốt lifetime, kể cả sau rejected/withdrawn. Job duplicate có jobId mới được apply bình thường.
- Apply job đã closed.
- Apply job đã expired.
- Apply job cá nhân của chính mình hoặc job Company mình hiện là OWNER/MANAGER.

Employer không được:

- Xem applicant ngoài ownership/current Company OWNER/MANAGER scope của mình.
- Chỉnh sửa job ngoài ownership/current Company OWNER/MANAGER scope của mình.
- Gửi offer cho worker không hợp lệ.

Review chỉ được tạo khi:

Engagement.status = COMPLETED

và user thực sự là participant của Engagement. Không cần chờ toàn multi-headcount Job COMPLETED.

---

# 14. Matching Engine V1

Không dùng AI/ML. Match Score / mức độ phù hợp không phải xác suất được tuyển. V1 UI hiển thị score và coverage/profile-completeness khi thích hợp, không hiển thị score range.

Required skills: mỗi yêu cầu kỹ năng hỗ trợ required=true/false. Required skill thiếu hoặc dưới configured level có thể khiến worker ineligible; non-required skills tham gia scoring. Không mặc định mọi listed skill đều hard requirement.

Score:

Skill match: 35%

Availability: 20%

Location: 15%

Compensation compatibility: 10%

Experience: 10%

Rating: 5%

Response/completion history: 5%

Ví dụ:

Worker:

Skill 90%

Availability 100%

Location 80%

Compensation 100%

Experience 80%

Rating 95%

Reliability 90%

Kết quả khoảng:

91% match.

---

# 15. Search

Worker search jobs bằng:

- Keyword.
- Category.
- Location.
- Work mode.
- Employment type.
- Compensation.
- Date.
- Skill.

Employer search worker bằng:

- Skill.
- Location.
- Availability.
- Rating.
- Experience.

---

# 16. Chat

Chat chỉ mở khi:

Worker apply job

hoặc

Employer invite worker và Worker accepts invitation. Invite đơn thuần không mở chat.

Conversation phải liên kết với:

job_id

worker_id

employer_id (hoặc owning Company với current OWNER/MANAGER access cho company-owned job)

Không cho phép người lạ spam tất cả user hoặc arbitrary direct messaging. Worker application cấp quyền job conversation cho worker và employer liên quan; invitation chỉ cấp quyền sau worker acceptance.

---

# 17. Notification

V1 cần:

Worker:

- Application viewed.
- Shortlisted.
- Offer received.
- Message received.
- Job status changed.

Employer:

- New application.
- Message.
- Offer accepted.
- Worker withdrew.

Channels:

In-app.

Email.

Push notification làm sau.

---

# 18. Reviews

Sau khi Engagement riêng đạt COMPLETED, kể cả toàn Job chưa COMPLETED:

Một review mỗi direction mỗi Engagement; không double-blind và không edit sau submit V1. Admin có thể hide qua moderation, không rewrite nội dung. Rating aggregates có sample count và rebuild được.

Employer → WorkerProfile.

Worker → Company nếu company-owned job, nếu cá nhân thì EmployerProfile.

Rating:

1–5 stars.

Các tiêu chí Worker:

- Reliability.
- Quality.
- Communication.
- Punctuality.

Employer:

- Job accuracy.
- Communication.
- Payment reliability.
- Working experience.

---

# 19. Trust System

Worker:

Email verified.

Phone verified.

Identity verified — V2.

Employer:

Email verified.

Phone verified.

Company verified.

Business registration verification — V2.

Initial auth: Better Auth, email+password, email verification bắt buộc. Worker verified email trước apply; Employer verified email trước publish. Không thêm social provider trong Foundation; Google có thể làm sau.

Phone verification có trong product model nhưng không bắt buộc initial alpha; policy apply/publish phải review lại trước public launch. Company verification là trust badge, không prerequisite posting. Không identity-document/business-registration-document upload V1.

---

# 20. Fraud Controls

System phải support:

Report user.

Report job.

Block user.

Khi không có active Engagement, block chặn future message/invitation/contact. Active Engagement là ACCEPTED hoặc IN_PROGRESS: block không ngăn access engagement, complete/cancel, required job conversation hoặc mở dispute; block áp dụng đầy đủ sau khi nghĩa vụ kết thúc.

Suspended user không được tạo activity mới (publish/apply/invite/new offers/unrelated conversations). Vẫn giữ quyền tối thiểu cần complete/cancel/communicate/dispute existing active Engagement theo policy; đây không phải unrestricted access.

Admin moderation.

Risk flags.

Ví dụ automatic flag:

- Employer đăng 30 jobs/ngày.
- Nội dung chứa Telegram/WhatsApp bất thường.
- Yêu cầu đóng tiền.
- Compensation quá bất thường.
- Job bị nhiều người report.

---

# 21. Admin Dashboard

URL:

/admin

Sections:

Dashboard

Users

Workers

Employers

Companies

Jobs

Applications

Reports

Verification

Moderation

Audit Log

---

# 22. MVP V1

MVP bắt buộc có:

Authentication

Worker Profile

Employer Profile

Company Profile

Job Creation

Job Listing

Job Search

Job Detail

Applications

Employer Applicant Dashboard

Matching V1

Messaging

Notifications

Favorites

Reviews

Reports

Admin

---

# 23. KHÔNG làm trong MVP

Payment.

Escrow.

Wallet.

Video interview.

AI resume builder.

AI interview.

Native mobile app.

Blockchain.

Payroll.

Complex recommendation ML.

CV upload. Identity-document/business-registration-document uploads. Không general document-management subsystem; avatar/company logo có thể thêm khi cần.

---

# 24. Monetization V1

Ban đầu:

Worker: Free.

Employer:

Free tier:

Tối đa 3 active jobs: PUBLISHED + PAUSED. DRAFT/CLOSED/COMPLETED/CANCELLED không tính. Company-owned quota thuộc Company; individual quota thuộc EmployerProfile. Publish/resume checks phải atomic để chống concurrency bypass.

Paid tier sau này:

More active jobs.

Boost job.

Featured job.

Access advanced worker search.

Employer verification.

Subscription.

Ví dụ dài hạn:

Basic — Free.

Pro — Monthly subscription.

Business — Team account.

---

# 25. KPI chính

Không sử dụng pageviews làm KPI quan trọng nhất.

North Star Metric:

Completed Engagements. Successful Match = một Engagement đạt COMPLETED; các funnel metrics khác theo dõi riêng.

Supporting metrics:

Jobs published.

Applications/job.

Employer response rate.

Application → shortlist rate.

Shortlist → hire rate.

Job completion rate.

Time to first applicant.

Time to hire.

Worker repeat rate.

Employer repeat rate.

---

# 26. Marketplace Liquidity

KPI cực kỳ quan trọng:

Một job đăng lên cần nhận applicant phù hợp trong bao lâu?

Target V1:

50% jobs:

≥3 relevant applicants trong 24 giờ.

Initial Relevant Applicant = eligible worker AND match score >= 70 AND match coverage >= 60%. Definition phải versioned/configurable, giữ được semantics lịch sử khi reporting thay đổi.

Nếu không đạt:

Marketplace đang thiếu liquidity.

---

# 27. Kiến trúc kỹ thuật

Frontend:

Next.js

TypeScript

TailwindCSS

shadcn/ui

Backend:

Next.js Server Actions/API

PostgreSQL

Prisma

Auth:

Better Auth. Initial email + password; email verification required; Google login có thể bổ sung sau.

Storage:

Cloudflare R2.

Email:

Resend.

Analytics:

PostHog.

Monitoring:

Sentry.

Hosting:

Vercel.

Architecture:

Modular Monolith.

---

# 28. Module Structure

/modules

auth

users

workers

employers

companies

jobs

applications

matching

messages

notifications

reviews

reports

admin

---

# 29. Security Principles

Mọi API phải check:

Authentication

Role

Ownership

Resource State

Không dựa vào frontend permission.

Ví dụ:

Không phải:

if user logged in → show application.

Mà:

Individual job: current user owns EmployerProfile; company-owned job: current user has current OWNER/MANAGER membership in owning Company. Creator leaving company does not retain access merely by createdBy identity.

---

# 30. Product Principle

Mỗi feature phải trả lời được ít nhất một trong ba câu hỏi:

1. Giúp worker tìm việc nhanh hơn?

2. Giúp employer tìm đúng người nhanh hơn?

3. Tăng trust của marketplace?

Nếu không đạt một trong ba mục tiêu thì không ưu tiên trong MVP.

---

# 31. Product tagline tạm thời

Tìm đúng việc. Gặp đúng người.

Hoặc:

Công việc phù hợp, người phù hợp.

Tên thương hiệu chưa khóa ở giai đoạn này.

---

# 32. Mục tiêu của MVP

MVP không nhằm chứng minh:

Website có nhiều feature.

MVP cần chứng minh:

Employer đăng job.

↓

Worker phù hợp nhìn thấy.

↓

Worker apply.

↓

Employer chọn.

↓

Hai bên hoàn thành công việc.

↓

Hai bên quay lại sử dụng tiếp.

Nếu vòng lặp này hoạt động thì sản phẩm có cơ sở để tiếp tục mở rộng.

# 33. Data deletion và retention

Hỗ trợ hướng phát triển soft deletion, anonymization và account deletion workflows. Không naive cascading delete historical transactional/audit data. Không tự đặt legal retention periods; precise retention là legal/security decision trước production, không blocker Foundation.

# 34. Approved review change record

Phase 0 review: chốt dual roles/company ownership, hiring split/lifecycle/terms/capacity/quota, engagement-based reviews, score/coverage, discovery privacy, invitation acceptance/blocking/suspension, Better Auth/verification và operational KPI. §13/18 thay review gate job COMPLETED bằng Engagement COMPLETED; §12 tách work states khỏi Application; §16 invite cần acceptance. PRODUCT tiếp tục là source of truth; implementation-only details thuộc PHASE_0 và architecture documents.


