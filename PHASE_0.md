# Phase 0 — Implementation Planning

Phase 0 review completed. PRODUCT.md là source of truth đã cập nhật theo 27 approved decisions. APPROVED = quyết định được user duyệt; DESIGN PROPOSAL = chi tiết triển khai đề xuất, không tự nhận đã approved; DEFERRED = chỉ các mục D1–D9 ở §15. Documentation finalized; chưa authorize implementation. Không scaffold/package/schema/migration/deploy.

## 1. Executive Summary

MVP là marketplace hai chiều, tập trung năm nhóm nghề và bảy employment types trong PRODUCT, đo bằng successful matches và liquidity. Giữ đủ scope §22, không thêm payment/escrow/wallet/payroll/AI/native app.

APPROVED: modular monolith trên target stack; Better Auth email/password, email verification; dual Worker/Employer profiles; company ownership; Application/Offer/Engagement riêng; review theo completed Engagement; score+coverage; opted-in employer discovery; invitation acceptance; active-obligation exceptions; Completed Engagements North Star. DESIGN PROPOSAL: folder names, Zod, errors/lock/query strategy bên dưới là implementation guidance, không approval thêm infrastructure. Remaining decisions chỉ §15.

## 2. Architecture — approved boundaries and implementation proposals

Cấu trúc dự kiến, chưa tạo:

- `src/app/(public)`: landing, jobs, public employer/company projections.
- `src/app/(auth)`: sign-in/up, verify email, reset password.
- `src/app/(worker)/worker`, `(employer)/employer`, `(admin)/admin`: route groups, không đổi URL.
- `src/app/(account)/account`: tài khoản chung; messaging/notifications có route riêng.
- `src/app/api/auth/[...all]`: auth adapter; webhook và internal scheduled handlers riêng, xác thực chữ ký/secret.
- `src/modules/<domain>`: contracts/DTO, validation, policies, services, repositories, tests.
- `src/shared`: db/session/clock/errors/logger/email/storage adapters, không business logic.
- `src/components/ui`: shadcn primitives; feature components ở module.

Server Components gọi query service nhận DTO đã lọc quyền. Client Components chỉ form/filter/chat composer; không import Prisma/repositories/secrets. Server Actions/Route Handlers là transport: session → parse → service → safe result. Không tạo REST song song mọi action. Node runtime phù hợp DB driver, pool có giới hạn và region gần DB.

Service sở hữu authorization, invariant, transaction. Repository nhận server-derived scope và transaction; private read/count/export lọc tenant ngay SQL. Module khác import public API, không truy cập repository của nhau; orchestration lifecycle thuộc applications. Admin gọi services có policy, không bypass qua DB.

Validation đề xuất Zod ở ingress, whitelist input, length/payload limits; FK/UNIQUE/CHECK là lớp cuối. UTC timestamps + IANA timezone cho lịch, half-open intervals; money decimal/integer minor unit, không float. TypeScript strict không thay validation.

Authorization deny-by-default: authentication + current account restrictions theo action + role + ownership + membership/capability + resource state + field projection. Proxy chỉ redirect; every protected page/action/handler kiểm tra session thật. Mutation nhạy cảm recheck memberships/restriction trong transaction, không tin browser/cookie role cũ. Suspended không đồng nghĩa deny mọi access: scope ngoại lệ chỉ existing active Engagement ACCEPTED/IN_PROGRESS, required conversation, completion/cancel/dispute. Không dùng exception để publish/apply/invite/new offer hay mở unrelated chat. Banned-account exception policy còn D5.

Errors: VALIDATION/UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/CONFLICT/RATE_LIMITED/INTERNAL; API 400/401/403/404/409/429/500. Private out-of-scope ID trả 404 đồng nhất; không stack/SQL ra client. JSON logs requestId/actor/action/resource/outcome/duration, redact PII/token/document/message body. Audit business riêng, Sentry scrub PII.

| Module | Ownership / dependency |
|---|---|
| auth | identity adapter/session → users/provider |
| users | account status/roles → audit |
| workers | profile/skill/experience/education/availability → users/verification |
| employers | demand profile → users/companies |
| companies | company/membership/tenant → users/audit |
| jobs | requirements/state/quota → employers/companies/audit |
| applications | applications/offers/engagements orchestration → jobs/workers/audit |
| matching | pure versioned scorer → job/worker/reputation DTO |
| messages | conversation/grants/messages → applications/users |
| notifications | inbox/outbox/email → recipient policy/email adapter |
| favorites | saved jobs → workers/jobs |
| reviews | eligibility/reputation → engagements/jobs |
| reports | report/block/risk signals → users/jobs |
| verification | evidence/badges/decisions → users/companies/audit |
| moderation | hide/restrict/ban → reports/jobs/users/audit |
| admin | guarded queries/commands → module public APIs |
| audit | append-only business/security history → database |

Phase 7 DESIGN PROPOSAL (không Foundation): transactional outbox với event và business change cùng commit; scheduled handler claim/lease batch, retry backoff, dead-letter/manual retry audited. At-least-once + dedupe, không hứa exactly-once email. Không fire-and-forget serverless. Deadline check ngay trong apply/accept kể cả scheduler chậm; expiry sweep chỉ tối ưu. APPROVED polling V1, no initial WebSocket/realtime infrastructure; adapter có thể bổ sung sau. Shared rate limits đề xuất DB, không memory mỗi instance. Không microservices, external event bus hoặc search engine mới.

## 3. Domain Model

Identity: User, UserRole, provider Session/Account/VerificationToken. Supply: WorkerProfile, Skill, WorkerSkill, AvailabilitySlot, Experience, Education, LocationPreference. Demand: EmployerProfile, Company, CompanyMember, Job, JobSkill, JobSchedule. Hiring: Application, Offer, Engagement. Communication: Conversation, Member, Message, Notification, Outbox. Trust: Review, Report, Block, Verification, ModerationAction, AuditLog.

APPROVED User 0..1 WorkerProfile và 0..1 EmployerProfile, cả hai được coexist; ADMIN operational, no self-grant; User N:N Company qua membership. Employer 1:N Jobs; companyId optional. APPROVED companyId có giá trị thì Company owns job; createdByUserId/employerProfileId lưu provenance, creator rời công ty không làm đổi ownership hoặc giữ quyền. Membership V1 OWNER/MANAGER, không enterprise capability engine. Worker N:N Skill; Job N:N Skill. Job 1:N Applications, unique job/worker lifetime. Application 1:N Offer revisions, 0..1 Engagement V1. Accepted offer 1:1 Engagement. Job nhiều headcount có nhiều engagements.

Conversation unique job/worker/owning-demand-scope, chỉ grant từ application hoặc invitation ACCEPTED. Review gắn Engagement + direction + profile/company subjects, chỉ khi Engagement COMPLETED, không đợi job completion. Aggregates là projection rebuild được.

Rules gốc: cấm apply trùng, closed, expired, tự thuê; không employer cross-tenant read/edit; offer cho worker hợp lệ; review chỉ participant đúng completion; không xóa job; tối đa ba active jobs free. APPROVED no lifetime reapply, active=PUBLISHED+PAUSED, completion employer confirms sau worker request, company OWNER/MANAGER scope. Material job terms bị khóa sau application đầu tiên; close/duplicate tạo jobId mới. Minimum apply: name/headline/city hoặc Remote/work preference/≥1 skill; PART_TIME/TEMPORARY/SHIFT cần availability; verified email, no CV.

Dependencies: auth/policies → profiles/company → jobs → hiring → messaging/reviews; search cần structured profiles/jobs, matching cần availability/pay/experience/reputation; notifications tiêu thụ events; admin/moderation cần policies/audit từ đầu.

## 4. Permission Matrix

R read, C create, U update, A archive/status action. Own = đúng chủ thể; Scope = owner hoặc current company membership có capability; Participant = linked actor thực sự. Tất cả còn phụ thuộc action restrictions/state/field DTO; suspended existing-active-obligation exception áp dụng ở service, không unrestricted bypass. Guest mọi mutation đều deny.

| Resource | Guest | Worker | Employer | Admin |
|---|---|---|---|---|
| User | — | R/U Own fields | R/U Own fields | R tối thiểu; suspend/ban, không sửa credentials |
| WorkerProfile | — | C/R/U Own + discovery/compensation preferences | R opted-in discovery DTO, no contacts/raw schedule/private metadata | case-bound R/verify |
| EmployerProfile | public R | public R | C/R/U Own | R/verify/restrict |
| Company/member | public company R | public company R | C company; R/U Scope; OWNER/MANAGER membership | R/verify/moderate; không tự join |
| Job | public R | public R | C/R/U/A Scope + state | R/hide/unhide; không hire thay |
| Application | — | C/R Own; withdraw | R Scope; view/shortlist/reject | investigation R; không hire thay |
| Offer | — | R Own; accept/decline | C/R Scope; revoke | case-bound R |
| Engagement | — | R Own; work actions theo §5 kể cả scoped suspension/block exception | R Scope; work actions theo §5 kể cả scoped suspension/block exception | case-bound R; FORCE_COMPLETE/FORCE_CANCEL case-bound + reason/actor/time/immutable audit |
| Favorite | — | C/R/remove Own | — | — |
| Conversation/message | — | R/C Participant sau grant | R/C Participant sau grant | no routine read; reason/audit investigation |
| Notification | — | R/mark-read Own | R/mark-read Own | delivery retry, không đọc inbox tùy ý |
| Review | public R | C Participant + Engagement COMPLETED; immutable | C Participant + Engagement COMPLETED; immutable | hide, không sửa lời user |
| Report/block | — | C/R Own status; block/unblock | C/R Own status; block/unblock | triage/resolve, reporter private |
| Verification | public badge | C/R Own request | C/R Own/Scope request | approve/reject badge audited; no V2 document uploads |
| Moderation/Audit | — | — | — | R; C action/audit via services; no U/delete audit |

Không quyền delete job; archive bằng state. Xóa account là future privacy workflow D7, không cascade lịch sử. Admin không universal hard-delete. APPROVED company OWNER/MANAGER only, không enterprise permissions hoặc paid team scope. Mọi private list/count/nested mutation kiểm scope, không chỉ route. Revoke membership phải chặn access mới ngay; concurrency recheck version/locks trong mutation.

## 5. State Machines

APPROVED states/actors/invariants bên dưới. Graph cạnh chi tiết giữ DESIGN PROPOSAL khi review chưa quy định; unlisted transitions deny, version/idempotency/audit. Terminal không reopen.

### Job

| Transition | Actor | Guard / status |
|---|---|---|
| DRAFT → PUBLISHED | Employer owner/current company OWNER/MANAGER | verified email, valid fields/deadline, atomic owner quota; graph proposal |
| DRAFT → CANCELLED | Employer Scope | no hire; graph proposal |
| PUBLISHED → PAUSED | Employer Scope | stop new applications; graph proposal |
| PAUSED → PUBLISHED | Employer Scope | valid deadline/atomic quota; graph proposal |
| PUBLISHED/PAUSED → CLOSED | Employer Scope; expiry sweep proposal | no new applications; CLOSED no reopen APPROVED |
| CLOSED → COMPLETED | Employer Scope | job-level completion criteria D2; never infer from one completed worker |
| PUBLISHED/PAUSED/CLOSED → CANCELLED | Employer Scope | resolve active obligations/pending lifecycle under D2; graph proposal |

COMPLETED/CANCELLED terminal APPROVED. Duplicate CLOSED creates new DRAFT/new jobId, no copied applications/offers/reviews. CLOSED permits existing valid pending offers until expiry, unless CANCELLED/COMPLETED; accept still checks eligibility/capacity/account restrictions. Whether new offers may be sent after CLOSED remains D2; do not confuse with approved pending-offer acceptance.

Material edits after first Application: no in-place compensation/location/type/start/end/schedule changes; headcount reduction below occupied slots forbidden. Changes require close/duplicate; non-material description wording allowed. Accepted terms immutable. Non-reducing capacity changes policy D2, not implicit approval. Hidden overlay independent; hidden-offer acceptance behavior D5.

Quota APPROVED maximum three PUBLISHED+PAUSED per Company or individual EmployerProfile; other states excluded. Design: lock demand owner/quota scope for publish/resume check+write atomically.

### Application

APPLIED → VIEWED → SHORTLISTED → OFFERED → ACCEPTED; no IN_PROGRESS/COMPLETED states. Graph detail view/shortlist sequencing is retained proposal.

| Transition | Actor | Guard |
|---|---|---|
| none → APPLIED | Worker | verified email, minimum profile, availability for PART_TIME/TEMPORARY/SHIFT, job open/unexpired, lifetime unique pair, not own individual/company OWNER/MANAGER job |
| APPLIED → VIEWED | Employer Scope | actual view, idempotent |
| VIEWED → SHORTLISTED | Employer Scope | valid applicant |
| SHORTLISTED → OFFERED | Employer Scope | atomic create one pending offer |
| OFFERED → ACCEPTED | Worker Own | atomic accept and Engagement creation |
| APPLIED/VIEWED/SHORTLISTED → REJECTED | Employer Scope | no pending accepted commitment |
| APPLIED/VIEWED/SHORTLISTED/OFFERED → WITHDRAWN | Worker Own | before acceptance; pending offer cleanup same transaction |
| APPLIED/VIEWED/SHORTLISTED/OFFERED → CANCELLED | system for job cancellation | no Engagement; cleanup pending offer |
| OFFERED → SHORTLISTED | system on DECLINED/REVOKED/EXPIRED | APPROVED, employer may send revised offer |

ACCEPTED terminal recruitment step; REJECTED/WITHDRAWN/CANCELLED terminal. UNIQUE(jobId,workerId) lifetime, no reapply; duplicate jobId new permits apply. Cleanup of offer during withdrawal/job cancellation must not reopen terminal Application: return-to-shortlist applies only to Application still OFFERED.

### Offer

APPROVED PENDING → ACCEPTED (Worker), DECLINED (Worker), REVOKED (Employer/system), EXPIRED (system/deadline). Target states terminal. Terms immutable; revision new record; only one pending/application. New offer after decline/revoke/expiry permitted while application eligible; no new offer after Engagement exists.

Accept rechecks worker eligibility, job state including CLOSED allowance, expiry, occupied slots, account restrictions. Atomic accept+Engagement with unique acceptedOfferId/applicationId. Design lock job→application→offer, conditional version and count occupied slots under lock; prevent competing last-slot accepts. Suspended worker accepting a new offer creates a new obligation, not existing-active-engagement exception.

### Engagement

APPROVED ACCEPTED → IN_PROGRESS (Employer confirms start) → COMPLETED (Worker requests, Employer confirms). No automatic time-only completion. ACCEPTED/IN_PROGRESS → CANCELLED allowed; ordinary cancellation initiator/consent details deferred D2, prior bilateral assumption is not approved.

Admin case-bound FORCE_COMPLETE/FORCE_CANCEL for dispute/unresponsive counterpart: reason+adminActor+timestamp+immutable AuditLog required. FORCE_COMPLETE can resolve active ACCEPTED/IN_PROGRESS case under admin guard; does not authorize arbitrary editing/rewriting terminal history. COMPLETED/CANCELLED terminal.

Occupied slots APPROVED: ACCEPTED/IN_PROGRESS/COMPLETED; CANCELLED excluded. Review eligibility is individual Engagement COMPLETED, independent whole Job status. Employer→WorkerProfile; Worker→Company when company-owned, otherwise EmployerProfile. One direction per Engagement, immutable after submit, no double-blind; moderation hide only. Block/suspension cannot prevent necessary access/required conversation/completion/cancel/dispute for active obligation; normal block resumes when obligation ends.
## 6. Conceptual Database Schema

Conceptual only, không Prisma schema/migration. Ownership/lifecycle/uniqueness/privacy invariants APPROVED; model decomposition, field names và indexes là DESIGN PROPOSAL, triển khai ở phase sở hữu requirement. NotificationOutbox chỉ Phase 7; MediaAsset chỉ avatar/logo khi cần. Không general document hoặc enterprise infrastructure. Mọi record có opaque id/createdAt, mutable có updatedAt/version. FK lifecycle RESTRICT, không cascade mất lịch sử. CHECK money ≥0/min≤max, headcount>0, rating 1..5, end>start. Unique cũng là index. Tenant consistency qua composite FK hoặc transaction invariant. I=index; U=unique, ngoài PK.

| Model / purpose | Important fields + relationships | Unique / indexes | Privacy |
|---|---|---|---|
| User / principal | normalizedEmail,name,status,emailVerifiedAt,encryptedPhone,phoneVerifiedAt; profiles/roles/auth | U(email); I(status,createdAt) | contacts owner-only, no raw auth DTO |
| UserRole / dual roles approved | userId FK,role,grantedBy | U(userId,role) | ADMIN trusted provisioning |
| Session/Account/auth tokens | userId,provider,providerAccountId,expiry,credentials; provider adapter contract | U(provider,providerAccountId); I(userId),I(expiry) | server-only, tokens protected |
| WorkerProfile / supply | userId,headline,bio,city/district,workModes,expected hourly/daily/monthly rates,currency,discoverable,compensationVisibility | U(userId); I(city,district),I(discoverable) | projected fields by scope |
| WorkerExperience/Education | workerId; company/position/start/end/description; school/major/degree | I(workerId,startDate) | profile consent/visibility |
| AvailabilitySlot | workerId,weekday,start/end local,timezone,effective dates,exceptions | I(workerId,weekday,effectiveFrom) | raw schedule private |
| WorkerLocationPreference | workerId,city/district or remote key | U(workerId,locationKey) | coarse only, not home address |
| EmployerProfile / demand | userId,type,name,description,industry,size,location,website,logoAssetId | U(userId); I(type,city) | contact private, badge derived |
| Company / tenant | name,description,industry,size,location,website,logoAssetId,status | I(status,city); name not unique | public projection vs evidence |
| CompanyMember | companyId,userId,role OWNER/MANAGER,status,joinedAt | U(companyId,userId); I(userId,status) | private, current membership |
| Skill / taxonomy | slug,label,category,status | U(slug); I(category,status) | public controlled vocabulary |
| WorkerSkill | workerId,skillId,level | U(workerId,skillId); I(skillId,level,workerId) | profile visibility |
| Job / demand unit | employerProfileId,companyId?,createdByUserId; title/description/category/type/mode/location; start/end/timezone/duration; payType/min/max/currency; experience/education/language; headcount/deadline/urgency/status/hiddenAt/publishedAt | I(status,deadline,publishedAt,id); I(companyId,status); I(employerProfileId,status); I(category,city,type); GIN searchVector | exact address release timing D3 |
| JobSchedule | jobId,startAt,endAt,timezone or recurrence+validity | I(jobId,startAt) | structured for overlap |
| JobSkill | jobId,skillId,requiredLevel,required flag | U(jobId,skillId); I(skillId,jobId) | public requirements |
| Application | jobId,workerId,coverNote,status,viewedAt,submittedAt,version | U(jobId,workerId); I(jobId,status,submittedAt,id); I(workerId,status,submittedAt,id) | applicant/tenant only |
| Offer | applicationId,revision,immutableTermsSnapshot,expiresAt,status,sentByUserId | U(applicationId,revision); partial U(applicationId) WHERE pending; I(status,expiresAt) | private participants |
| Engagement | applicationId,acceptedOfferId,jobId,workerId,termsSnapshot,status,startConfirmedAt,completionRequestedAt,completedAt,cancelRequestedBy | U(applicationId),U(acceptedOfferId); I(jobId,status),I(workerId,status) | participant/case-bound |
| Favorite | workerId,jobId | U(workerId,jobId); I(workerId,createdAt,id) | owner-only, removable |
| Invitation / accepted chat grant | jobId,workerId,demandScope,sentBy,status,acceptedAt,expiresAt; proposal states PENDING/ACCEPTED/DECLINED/REVOKED/EXPIRED | U(jobId,workerId,demandScope); I(workerId,status) | no chat until invitation accepted |
| Conversation | jobId,workerId,individualEmployerId?/companyId?,applicationId?/acceptedInvitationId?,status,lastMessageAt | U(jobId,workerId,demandScope); I(lastMessageAt,id) | relationship gate |
| ConversationMember | conversationId,userId,joinedAt,leftAt,lastReadMessageId | U(conversationId,userId); I(userId,leftAt) | recheck tenant/revocation too |
| Message | conversationId,senderId,body,clientMessageId,moderationHiddenAt | U(senderId,clientMessageId); I(conversationId,createdAt,id) | private, no body logs |
| Notification | recipientId,type,resourceType/id,safePayload,readAt,eventKey | U(recipientId,eventKey); I(recipientId,readAt,createdAt,id) | Own; linked resource recheck |
| NotificationOutbox | eventKey,recipientId,channel,payload,status,attempts,nextAttemptAt,lockedUntil,providerMessageId | U(eventKey,recipientId,channel); I(status,nextAttemptAt) | minimized payload, retention |
| Review | engagementId,jobId,submittedByUserId,direction,workerProfileId,employerProfileId?/companyId?,overallRating,criterionRatings,text,hiddenAt | U(engagementId,direction); I(reviewSubject,createdAt,id) | immutable; completed Engagement gate, no double-blind |
| Report | reporterId,targetUserId?/targetJobId?,reason,details,status,assignedAdminId | CHECK one target; I(status,createdAt),I(targetJobId,status),I(reporterId) | reporter identity admin-only |
| UserBlock | blockerId,blockedId | U(blockerId,blockedId); CHECK unequal; I(blockedId) | private relation |
| Verification | subjectUserId?/subjectCompanyId?,kind,status,reviewerId,reason,verifiedAt,expiresAt; no identity/business document assets V1 | CHECK one subject; I(subject,kind,status),I(status,createdAt) | trust badge decisions private; V2 evidence not collected |
| ModerationAction | reportId/caseId?,target user/job/engagement,actorAdminId,type including FORCE_COMPLETE/FORCE_CANCEL,reason,start/end,reversedByActionId | I(target,createdAt),I(actorAdminId,createdAt) | admin-only, immutable action/reversal |
| AuditLog | actorId?,action,targetType/id,requestId,safeBeforeAfter,reason,occurredAt | I(targetType,targetId,occurredAt),I(actorId,occurredAt),I(requestId) | append-only; restricted |
| MediaAsset / avatar-logo only when needed | ownerId/companyId,objectKey,purpose AVATAR/LOGO,mime,size,visibility,deletedAt; no generic docs/scan pipeline | U(objectKey); I(ownerId,purpose) | no permanent public private-file URL |

Extra support models phục vụ yêu cầu structured profiles, blocking, invites và durable delivery, không mở payment scope. APPROVED no CV upload V1. Media metadata chỉ avatar/logo khi cần, không document-management subsystem. Identity/business-registration verification thuộc V2, không thu tài liệu này trong V1. Auth verification token khác domain Verification. Taxonomy city/district/category cần seed decisions D1 trước profile/job schema, không blocker Foundation. Partial constraints/FTS có thể cần SQL migration riêng sau này.

Reputation aggregates lưu sampleCount/computedAt/formulaVersion và rebuild được; không average-of-averages. Response/completion denominator còn D1. Review subject là stable WorkerProfile/EmployerProfile/Company, không creator user; submittedByUserId chỉ actor provenance. Exactly one employer/company subject, consistent với job ownership snapshot. Snapshot offer/work bảo toàn điều kiện đã nhận khi job edit. Quản trị membership phải duy trì company có owner hợp lệ.

## 7. Authentication Recommendation

**APPROVED: Better Auth**, initial email+password, email verification required; no Foundation social providers. Google deferred. Phù hợp identity cùng PostgreSQL/Prisma, kiểm soát dữ liệu và ít vendor coupling. Business policies vẫn thuộc ứng dụng dù dùng provider nào. Tradeoff: đội tự chịu upgrades, incident response, email delivery, shared rate limiting và vận hành auth.

| Tiêu chí | Better Auth | Clerk |
|---|---|---|
| Next.js | handler/server session/client integration | SDK/prebuilt UI giúp triển khai nhanh |
| PostgreSQL/Prisma | Prisma adapter trực tiếp | hosted identity, domain DB cần identity mapping/sync |
| Roles | plugin/app tables; app owns ownership/state | hosted primitives; app vẫn owns tenant/state policies |
| Social/email verification | hỗ trợ, cần cấu hình provider/email | hosted configuration/integration |
| Extensibility | code/plugins/schema control | SDK/platform và plan capabilities |
| Lock-in | thấp hơn, vẫn coupling adapter/schema | cao hơn qua hosted identity/SDK |
| Cost | core open-source miễn phí; DB/email/ops có chi phí | free tier/paid features và usage; cần dự toán theo plan |

Không khóa giá/phiên bản ở Phase 0. Dự toán active users, email/phone volume, ops cost trước chọn plan. Không bổ sung social provider initial alpha; Google chỉ khi có yêu cầu phase sau. Nguồn chính thức kiểm tra 2026-10-07: [Better Auth Next.js](https://better-auth.com/docs/integrations/next), [Prisma adapter](https://better-auth.com/docs/adapters/prisma), [Better Auth](https://better-auth.com/), [Clerk Next.js](https://clerk.com/docs/nextjs/getting-started/quickstart), [Clerk pricing](https://clerk.com/pricing). Recommendation là đánh giá theo dự án.

Secure/httpOnly/sameSite cookie, origin allowlist chặt; không tự viết password crypto. ADMIN không qua signup body; trusted provision có audit. Suspension chặn new activity bằng current DB checks nhưng vẫn cho authenticated access tối thiểu vào active obligations; không blanket revoke khiến họ không thể complete/cancel/chat/dispute. Session strategy phải thực thi exception an toàn. Email/phone/company badges riêng; verified email required apply/publish; phone modeled but optional alpha, public-launch policy D4; company badge optional posting. Auth provider session cookie presence không chứng minh authenticated.

## 8. Matching Design

APPROVED weights: Skill 35%, Availability 20%, Location 15%, Compensation 10%, Experience 10%, Rating 5%, Reliability 5%. Match Score / mức độ phù hợp, never probability of hiring. Backend contract supports score, coverage, component breakdown, weightsVersion, computedAt. UI score+coverage/profile-completeness, **no score ranges V1**. PRODUCT example equals 90.75%, rounded 91%.

APPROVED JobSkill.required boolean: configured required skill absent/below required level may make worker ineligible; non-required skills participate in scoring. Never hard-filter all listed skills. Eligibility includes minimum profile/email/self-job/account restrictions and job recruiting state. Required-level policy/config remains D1.

DESIGN PROPOSAL normalize [0,1]:

| Component | Inputs / normalization |
|---|---|
| Skill | non-required skill coverage mean; min(workerLevel/targetLevel,1), explicit absent=0; how required skills also contribute is D1 |
| Availability | overlap minutes / required minutes, structured schedule/timezone/exceptions |
| Location | remote accepted=1; preferred district=1, city-only=0.5, outside=0; hybrid policy D1 |
| Compensation | same currency/pay period: max ≥ expected→1, otherwise max/expected clamped; no implicit month/hour/FX conversions |
| Experience | min(related non-overlapping experience months/required months,1); level mappings D1 |
| Rating | mean/5 with sampleCount, excluded hidden reviews; no history=unknown |
| Reliability | proposed equal responseRate/completionRate components; denominator/window/cancellation attribution D1 |

Missing-data policy remains D1, not silently approved by score+coverage decision. Candidate design for review: fixed weighted score with versioned priors for unknown components, coverage=sum observed/applicable weights; return unknown flags and priors in breakdown. Do not show ranges; do not call imputed score hiring probability. Exact priors/non-applicable treatment/rounding/sort tie-break need confirmation before Phase 6. Do not calculate official liquidity eligibility from an unapproved scoring version. Explicit zero and missing must remain distinguishable; no prior scored data should be rewritten when formula changes.

Batch realtime on bounded eligible candidate pool, no N+1/no full worker×job persistence. Design cache only after measurement, keys profile/job/reputation/weights versions; never use score cache for authorization. Immutable scoring config validates weight sum=1, versioned component policies, fixtures and explanations; material formula updates require review.

APPROVED liquidity: Relevant Applicant = eligible AND score>=70 AND coverage>=60%; target 50% jobs with ≥3 relevant applicants in 24h. At application time persist minimal eligibility/score/coverage/weightsVersion/definitionVersion/evaluatedAt fact; do not backfill historical relevance from current profile. Fact schema/dedupe/window rules are Phase 11 design; lifecycle timestamps must exist from Phase 5. Successful Match = Engagement reaching COMPLETED, primary North Star Completed Engagements, other funnel metrics separate.
## 9. Search Design

PostgreSQL FTS trước, adapter typed criteria/viewer scope → DTO/cursor; business rules ngoài adapter. Future engine chỉ thay candidate retrieval, recheck DB visibility trước hydrate results, không rewrite services. Search/cache must immediately respect discoverable=false and current company membership; no stale index grants.

Weighted tsvector title/description/skill labels; baseline `simple` cho tiếng Việt, không English stemming mặc định. Đánh giá unaccent extension và test có/không dấu trước khóa; không index email/phone/message/private evidence. Worker discovery chỉ authenticated Employer, discoverable=true; never public Worker directory. Compensation filter/matching respects preference permission.

Filters jobs: keyword/category/location/mode/employment type/pay type+currency+range/date overlap/skill. Worker: skill/location/availability/rating+sample count/experience. So sánh compensation cùng đơn vị, không sort monthly chung hourly. Sorting allowlist newest/relevance/pay/match. Keyset `(publishedAt,id)` hoặc pay/id; relevance rank/id với snapshot hoặc bounded offset V1 có ghi rõ reorder khi dữ liệu đổi. Cursor bound/signed filter/scope/sort, page cap đề xuất 50. Không client-set tenant scope, no unrestricted private counts.

GIN FTS; btree status/visibility/deadline/time, location/category/type theo query plan; bridges skillId/entityId; private owner/status indexes. Không index mọi tổ hợp. EXPLAIN ANALYZE trên realistic fixtures, latency budget chốt Phase 6; bounded candidate scoring và paginate trước relation hydration. Parameterized query, query length/complexity limits.

## 10. Security & Privacy Model

| Threat | Mitigation architecture / validation |
|---|---|
| IDOR/applicant leak | scoped queries/DTO allowlist/private files, cross-tenant read/write/count/nested tests |
| Privilege escalation | no role/status/membership mass assignment, trusted admin provisioning, current membership checks |
| Worker PII leak | field projections, coarse location/schedule, private bucket, no shared private cache |
| Spam/fake employer/job | verification signals, transactional quota, report/risk review, shared action rate limits |
| Mass messaging | application/accepted-invitation grant + participant + scoped block policies; invite không cấp private profile access |
| Scraping | page limits/minimized discovery/rate controls; robots không là access control |
| XSS | escaped plain text, sanitizer nếu rich text được duyệt, CSP |
| CSRF | auth-provider protection, origin/sameSite checks, no mutation GET, signed webhooks, no wildcard CORS |
| Upload abuse | avatar/logo only when required: purpose/owner/size/type/magic-byte validation, safe image handling; no CV/identity/business uploads, no generic malware pipeline during Foundation |
| Direct file access | media owner/company authorization; public avatar/logo only intentional safe projection; private originals signed access; no document download endpoints V1 |
| Rate-limit abuse | shared atomic DB counters account+IP+action, trusted proxy IP only, fail-closed sensitive mutations |
| Enumeration | generic reset/login responses, uniform private 404, throttle auth/search; opaque IDs không thay auth |
| Secret exposure | server-only env, no public secret prefix, redaction/scanning/rotation, isolated preview data |
| Race/replay | idempotency/unique/locks/version, concurrent integration tests |
| Admin misuse | case reason + audit + least privilege, separate operational account, DB access control |

Risk flags theo PRODUCT: >30 jobs/day, suspicious Telegram/WhatsApp, yêu cầu đóng tiền, abnormal pay, nhiều reports. Đề xuất flag manual review, không auto-ban heuristic deferred D5; ba active không ngăn publish/cancel nhiều lần. Reporter identity không lộ đối tượng bị report.

Privacy: các mức theo field/relationship, không có nghĩa mọi employer đọc mọi worker.

| Data | Classification / access |
|---|---|
| Employer/company public info, badges, rating | public DTO; evidence/reason không public |
| Worker headline/skills/coarse city | authenticated-Employer-only opted-in discovery projection; no public directory |
| Email/phone | owner-only; employer/worker đối tác không mặc định thấy; admin case-bound |
| CV | excluded V1; no upload/storage/share flow |
| Exact location | personal owner-only, never discovery; exact job address release timing deferred D3 |
| Availability | raw owner-only; discovery summary/overlap only, no raw schedule exposure |
| Expected compensation | owner-only full; discovery visibility per worker preference; server-side matching only where permitted |
| Applications/offers/engagements | worker-visible Own; employer-visible Scope; admin case-bound |
| Private messages | participants current entitlement; admin-only exceptional audited investigation |
| Verification documents | identity/business documents excluded V1; badge review metadata admin-only, own status visible |
| Notification/favorites | owner-only |
| Reports/risk/audit | own report status; reporter/evidence/risk/audit admin-only |

No identity/business-registration documents V1 (PRODUCT V2). Không general document management/malware-scanning pipeline; avatar/logo only when requirement needs. Phone modeled, optional alpha; provider/public-launch policy D4. Private RSC/response không share cache; email chỉ event+link, no chat body mặc định. Analytics không PII/form capture/session replay mặc định. Backup encrypted và access controlled; precise retention/export/anonymization/region cần D7 trước production, không blocker Foundation; support soft deletion/future workflows, never naive cascade transactional/audit history.

## 11. Route/Screen Map

Không UI detail. IDs không cấp quyền; role dưới đây còn cần field/state policy.

| Route | Purpose | Authorized roles |
|---|---|---|
| `/` | product entry | Guest/all |
| `/jobs`, `/jobs/[id]` | search/detail | Guest/all public DTO; participant snapshot riêng |
| `/employers/[id]`, `/companies/[id]` | public profile/reputation | Guest/all public DTO |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`, `/verify-email` | auth flows | Guest/đúng account hoặc token |
| `/worker` | overview | Worker Own |
| `/worker/profile`, `/worker/availability` | profile/skills/rates/schedule | Worker Own |
| `/worker/favorites` | saved jobs | Worker Own |
| `/worker/applications`, `/worker/applications/[id]` | progress/offer actions | Worker Own |
| `/worker/work/[id]` | work/completion/review | Worker Participant |
| `/employer` | hiring overview | Employer Scope |
| `/employer/profile`, `/employer/company` | demand/company/membership | Employer Own/Scope |
| `/employer/jobs`, `/employer/jobs/new`, `/employer/jobs/[id]/edit` | create/manage | Employer Scope + state |
| `/employer/jobs/[id]/applicants`, `/employer/applications/[id]` | compare/shortlist/offer | Employer Scope |
| `/employer/jobs/[id]/matches`, `/employer/workers/[id]` | suggestions/worker DTO | Employer Scope + discovery policy |
| `/employer/work/[id]` | engagement/confirm/review | Employer Scope |
| `/account`, `/account/verification` | account/verification | authenticated Own |
| `/notifications`, `/messages`, `/messages/[id]` | notifications/chat | Worker/Employer Own or eligible Participant; active-obligation suspension/block exception |
| `/reports/new`, `/reports/[id]` | report/status | Worker/Employer Own |
| `/admin` | KPIs | Admin |
| `/admin/users`, `/admin/workers`, `/admin/employers`, `/admin/companies` | account operations | Admin minimized DTO |
| `/admin/jobs`, `/admin/applications` | operational inspection | Admin case-bound |
| `/admin/reports`, `/admin/verification`, `/admin/moderation`, `/admin/audit-log` | trust operations | Admin reason/audit |

Review/block actions gắn work/profile/conversation; invitation inbox/accept ở account hoặc worker area; dispute case intake được cấp quyền từ active engagement, route riêng đề xuất `/account/engagements/[id]/dispute`. No general document upload page. APPROVED no public Worker directory V1. Internal jobs/health handlers không public UI.

## 12. Testing Strategy

Pyramid: nhiều unit cho policies/validation/state guards/matching; integration trên PostgreSQL thật cho constraints/FTS/transactions; ít E2E nhưng đủ critical workflows. Không SQLite để chứng minh PostgreSQL concurrency. Contract tests email/storage/auth adapters và sandbox smoke ở readiness.

Authorization tests data-driven: Guest/Worker/Employer/Admin × own/other tenant/revoked member/suspended × lifecycle states, ở service và transport. DB tests: company ownership after creator leaves; material edit blocked after first applicant; CLOSED pending offer still accepts until expiry; duplicate apply concurrent; publish quota concurrent; accept last slot; double accept; revoke membership race; pending offer unique; outbox retry/dedupe; review eligibility/unique. Clock injectable cho deadline/timezone, Vietnamese search fixtures; no production PII.

E2E bắt buộc:

1. Signup → email verify → login/logout/reset; session revoked bị chặn; suspended chỉ được scoped existing active-obligation access, no new activity.
2. Worker profile/skills/availability; employer/company profile → structured publish + ba active quota.
3. Search/filter/match → favorite → apply; duplicate/self/closed/expired bị chặn qua transport trực tiếp.
4. Employer view → shortlist → offer → Worker accept → start → complete request/confirm → Engagement COMPLETED → hai phía review kể cả Job chưa complete.
5. Employer A không đọc/sửa job/applicant/offer/conversation/file của B dù thay ID/body/URL.
6. Decline/expiry/revoke/reject/withdraw/cancel, không accept hết hạn hoặc chuyển terminal state.
7. Chat sau apply hoặc accepted invite; pending invite không grant; unrelated/revoked denied; block/suspension preserves required active-work conversation only; unread và notification đúng recipient; retry no duplicate inbox.
8. Report → admin triage → hide/suspend/ban → enforcement mọi module → immutable audit; FORCE_COMPLETE/FORCE_CANCEL requires case/reason/admin/time; no V2 evidence uploads.
9. Multi-headcount last-slot race và người hoàn thành sớm review ngay completed Engagement; one direction unique; company review subject stable after creator leaves.
10. No CV/identity/business-document endpoints; avatar/logo type/size/owner validation khi introduced, no premature scan subsystem.

CI Phase 0 kiểm tài liệu; Phase 1 lint/typecheck/unit; DB integration từ phase có DB; critical hiring E2E Phase 5, mở rộng sau. PR báo validation/invariants, không dùng coverage % thay meaningful tests. Performance budget chốt trước Phase 6/load readiness; staging E2E không gửi email thật ngoài sandbox.

## 13. Implementation Roadmap

Documentation finalized; **implementation chưa được authorize**. Phase 1 chỉ bắt đầu khi user yêu cầu. Approved product decisions không reopen như blockers. DESIGN PROPOSAL task slices dưới đây; each PR reviewable, tests target real invariants.

| Phase / objective | Dependencies / remaining gate | Deliverables / PR slices | Tests | Definition of Done |
|---|---|---|---|---|
| 1 Foundation | implementation authorization; compatible versions D8 | PR1 minimal scaffold/strict/env; PR2 DB/pool/CI/test harness; PR3 shared safe errors/logging/docs | build/typecheck/DB smoke/redaction | reproducible setup, no secrets; no outbox/enterprise/document/scan/WebSocket/microservice/external search infrastructure |
| 2 Auth/authorization | 1; approved dual roles, Better Auth | PR1 email/password/verify/reset; PR2 principal policies/operational admin; PR3 suspension-aware action scope | role spoofing/origin/session/suspended exceptions | email gates enforceable, ADMIN never self-granted; no social providers |
| 3 Profiles/company | 2; taxonomy/schedule D1, privacy details D3 | PR1 worker/skills/apply completeness; PR2 availability/rates/discovery prefs; PR3 employer/company OWNER/MANAGER; PR4 avatar/logo only if needed | DTO privacy/membership revoke/minimum profile | company retains jobs, no PII/raw schedule discovery, no CV/doc subsystem; legal durations not gate |
| 4 Jobs | 3; job-level details D2 | PR1 structured draft; PR2 lifecycle/material-lock/duplicate; PR3 owner atomic quota/list/detail | concurrent publish, edit after first apply, closed no reopen | three active per owner; no hard-delete; closed pending offers preserved |
| 5 Hiring | 4; cancellation/unresolved flow D2 | PR1 apply/view/shortlist; PR2 immutable revisions/atomic accept; PR3 engagements/start/request/confirm/dispute guard | capacity races/lifetime unique/minimum profile/self/company eligibility, snapshots | application→offer→engagement works, no work states on Application, no ghost/overbooking; timestamps/facts for later analytics |
| 6 Search/matching | 3–5; formulas/priors D1, query budget D8 | PR1 PG FTS/filters adapter; PR2 score+coverage+breakdown/version; PR3 opted-in discovery | required vs optional skills, missing data, Vietnamese search/latency/privacy | approved weights, no range UI/probability, no external engine |
| 7 Messaging/notifications | 5; invitation details D6, email operations D8 | PR1 invite acceptance/participant/block exception; PR2 polling/unread; PR3 durable outbox/in-app/email retry | pending invite denies chat, active-obligation exception ends, dedupe/provider failure | no arbitrary messaging; job-scoped, durable notifications; outbox built here not Foundation |
| 8 Reviews/reputation | 5; formulas D1 | PR1 per-Engagement/direction/subject review; PR2 sample-count/rebuild aggregates | completed Engagement only, company target, immutable/no double-blind, unique race | early completer reviews without Job completion; moderation hide only |
| 9 Reports/moderation/admin | existing modules; D5 | PR1 risk/cases; PR2 hide/restrict/ban; PR3 verification badges/admin sections; PR4 audited FORCE actions | case/reason/actor/time/audit, suspension exceptions, admin boundary | approved trust workflows; no identity/business documents; risk thresholds operationally configured |
| 10 Hardening | 1–9; D3/D5 | PR1 abuse/rate/cache/headers; PR2 privacy/soft-delete design; PR3 adversarial fixes | full auth matrix/concurrency/secret scan/media abuse | no critical/high findings, safe active-obligation access; no invented legal periods |
| 11 Analytics/monitoring | business facts from 5/6; windows D9 | PR1 Completed Engagements/funnel; PR2 versioned relevance>=70/coverage>=60 and liquidity; PR3 safe PostHog/Sentry alerts | historical fact/version/dedupe/denominator/PII tests | completed Engagement counted once, 50%/3/24h target measurable, no rescoring historical facts silently |
| 12 Production readiness | 1–11; D4/D7/D8/D9 | PR1 isolated deployment/env/restore drill; PR2 retention/release/rollback/incident runbooks; PR3 staging E2E/accessibility | restore/migration rehearsal/provider outage/full E2E | pre-public phone and legal/security policy reviewed, operational ownership signed; deployment separately authorized |

Security/action policies, audit and lifecycle timestamps begin at business-owning phase; admin case UI comes later. Verified email gates implemented with auth and enforced apply/publish, not deferred to admin. Phone provider and legal retention do not block Foundation. Do not build outbox until confirmed delivery work, enterprise capability engine, general document management, malware pipeline, WebSockets, microservices or external search engine during Foundation.
## 14. Repository Documentation Content Plan

Chỉ PRODUCT.md và PHASE_0.md được cập nhật ở lượt này. Chuẩn bị content plan cho sáu file sau, chưa tạo code hoặc biến chi tiết DESIGN PROPOSAL thành approved requirement. Mỗi file khi tạo sẽ liên kết PRODUCT và decision status, không duplicate source of truth.

### AGENTS.md

1. Context order: PRODUCT source of truth → PHASE_0 approved decisions → relevant module documentation; approved change request mới được sửa requirement.
2. Work scope: implementation chỉ khi user authorize phase; không scaffold/package/schema/migration/deploy từ documentation task. User có thể authorize phase sau mà không phải review lại các quyết định đã approved.
3. Approved invariants: dual roles/admin provisioning, company ownership/current OWNER/MANAGER, immutable terms, lifetime apply unique, atomic capacity/quota, per-engagement reviews, invitation acceptance, suspension/block exceptions, no public directory/document uploads.
4. Module public APIs, server authorization + scoped repositories + DTO, strict validation và transaction boundaries; no client authorization trust.
5. PR task boundaries/required tests, minimal relevant validation, record deferred decisions only where dependency thật sự áp dụng.
6. Foundation exclusions: no outbox/enterprise capabilities/generic document management/malware/WebSocket/microservice/external search infrastructure; no push/deploy implied by local edits.

### ARCHITECTURE.md

1. Approved stack/runtime boundaries và modular monolith; Better Auth email/password/email verification, polling adapter.
2. Proposed App Router tree/server-client/service/repository/contracts from §2; pending package/runtime versions D8.
3. Domain ownership map, company scope surviving creator departure, separate Application/Offer/Engagement; no direct cross-module repository calls.
4. Action-based authorization including active obligation exceptions and operational admin FORCE commands.
5. Transaction diagrams for apply, publish quota, accept+Engagement, review uniqueness; immutable snapshots/idempotency/lock order design.
6. Phase-specific external adapters: R2 avatar/logo only, Resend/outbox Phase 7, PostHog/Sentry monitoring; no premature infrastructure.
7. Approved/proposed/deferred decision register, impact and change process; provider operational choices D8.

### DATABASE.md

1. Conceptual model table §6 and cardinality, future implementation schema belongs to relevant phase.
2. Ownership fields createdByUserId/employerProfileId/companyId; membership OWNER/MANAGER and company-owner continuity.
3. Application lifetime unique; one pending Offer/revision; immutable Offer/Engagement terms; capacity counted from ACCEPTED/IN_PROGRESS/COMPLETED.
4. Review UNIQUE(engagementId,direction), stable subject WorkerProfile/EmployerProfile/Company, submittedByUserId provenance; aggregate sample counts/rebuild.
5. Conversation demand-owner scope and accepted-invitation grants; company membership recheck after creator departure.
6. Fields for discoverable/compensation visibility, phone verification modeled optional alpha; no CV/identity/business evidence/file generic schema.
7. FK/check/index/transaction/optimistic version proposals; no cascade transaction/audit destruction; future soft delete/anonymization support, precise durations D7 pre-production.
8. Minimal analytics historical facts with scoring/definition version; outbox table introduced Phase 7 only. Migration/backfill/rollback instructions only after implementation exists.

### SECURITY.md

1. Threat model and field-level privacy table §10; no directory, opted-in employer discovery, no email/phone/address/raw schedule/private metadata leakage.
2. Authorization matrix for dual roles/current company members/states/ownership; suspended and blocked active-obligation path vs denied new activity. Banned/hidden policy D5.
3. Verified email apply/publish, phone optional alpha pending pre-public policy, company badge optional posting; no V2 document collection.
4. CSRF/XSS/IDOR/spam/scraping/rate/secret/cache mitigations; safe avatar/logo purpose checks when needed, no general scan pipeline.
5. Admin FORCE reason/actor/timestamp/immutable audit, case-bound access, review hide not rewrite; operational incident/reporting contact D8.
6. Future deletion/anonymization and retention review D7, backups, isolation, redaction, least privilege and negative authorization tests.

### ROADMAP.md

1. §13 phase objectives/dependencies/PR slices/tests/DoD; approved decisions not unresolved blockers.
2. Implementation authorization distinct from planning approval; track completion by evidence, no automatic production release.
3. Decision timing: versions before foundation, formulas before matching, normal cancellation before hiring, legal durations/phone before public launch.
4. Deferred infrastructure schedule, end-to-end workflows, privacy/security built from first owning phase, operational readiness and rollback.

### DESIGN_SYSTEM.md

1. Vietnamese-first language/accessibility/keyboard/focus/contrast/error states and component conventions; detailed UI design deferred to UI phase.
2. Tailwind tokens/shadcn primitives and formatting of money/pay period/timezone, proposal rather than invented brand decisions.
3. Approved lifecycle vocabulary separated by entity, closed vs completed, request vs confirm vs case-bound force.
4. Match Score + coverage/profile completeness; no score ranges or hiring probability. Discovery/privacy toggles and no public worker directory.
5. Invitation pending/accepted feedback, scoped block/suspension obligations, per-engagement immutable review, rating sample counts and badge semantics.
6. No CV/identity/business upload UI, no payment/realtime promises, no infrastructure details in product flows.

README when later introduced: product purpose/document links and planning status; setup/test commands only after verified Foundation. PRODUCT may change only through approved product updates; implementation details remain in architecture docs.

## 15. OPEN_QUESTIONS — remaining deferred inputs only

Approved Q1–Q17 items from previous draft are closed where resolved. Remaining subtopics have new D IDs; none reopen dual roles/ownership/reviews/quotas/invitation acceptance/auth/metric thresholds. No legal retention/provider phone choice blocks Foundation.

| ID / decision timing | Genuine remaining input | Guard until resolved |
|---|---|---|
| D1 Product: structured data before Phase 3; scoring before 6; reputation before 8 | Skill taxonomy/level gate configuration, required skill scoring contribution, schedule granularity/recurrence/exceptions, location/hybrid/pay comparability and experience mappings, missing priors/non-applicable/coverage/rounding, response/completion rates/windows | fixed approved weights; score+coverage not ranges; unknown not silently zero; profile minimum and role gates already approved |
| D2 Product before Phase 4–5 | Ordinary cancellation actor/consent; unresolved applicants/offers when whole Job completes/cancels; new offers after CLOSED vs existing offers; headcount changes not below occupied and additional material fields | CLOSED pending offer acceptance already allowed; terminal states/immutable snapshots/occupied slots/admin FORCE already approved; do not assume bilateral cancel was approved |
| D3 Product/privacy before discovery UI Phase 3–6 | Default discovery/compensation preferences, exact job-address disclosure timing, any explicit contact-sharing flow, visibility of review text/worker identity beyond aggregate | no public directory; opted-in employer discovery only; no PII/raw availability/private metadata; compensation preference honored; no CV |
| D4 Product/provider before public launch (provider implementation only when needed) | Phone verification provider/channel/budget and apply/publish launch policy; company badge review criteria without V2 documents | email required for apply/publish; phone modeled but optional initial alpha; company badge not posting gate; no social providers initial auth |
| D5 Product/security/operations before moderation release Phase 9 | Ban vs suspension treatment, hidden-job effect on existing pending offer, abuse thresholds/appeal process, admin case triage/access/SLA and FORCE public reputation attribution | suspended/blocked existing active obligations preserved; no new suspended activity; FORCE case+reason+actor+time+immutable audit; hidden overlay not auto-complete/cancel |
| D6 Product/operations before messaging Phase 7 | Invitation lifetime/reinvite/rate budgets, expiry vs worker acceptance race, existing invitation acceptance when blocked/suspended, conversation read/history policy after obligation ends | pending invitation never grants chat; no arbitrary DM; active obligation necessary chat preserved then normal block applies; polling V1 |
| D7 Legal/security before production, NOT Foundation blocker | Legal retention periods/data region/consent/export/anonymization process and operational deletion owner | support future soft deletion/account deletion/anonymization; no naive cascade historical transaction/audit records; no invented durations |
| D8 Provider/technical/operations at relevant phase | Compatible runtime/package pins at Foundation; DB provider/regions/pooling/budgets; email/media provider setup, alert contacts, performance/rate budgets, release/restore owner before production | approved target stack/provider direction retained; no install/provision/deploy during docs; Google only future request |
| D9 Analytics product/ops before Phase 11 | 24h clock origin (first publish), eligible job denominator/cohort exclusions, time reporting timezone, late/cancelled applicants handling, admin-forced completion/reversal reporting semantics | North Star Completed Engagements fixed; relevance eligible AND score>=70 AND coverage>=60% fixed; version definition/facts, no retroactive rescoring |

## 16. Finalized Decisions, Contradictions and Remaining Risks

### Approved decision register / traceability

Numbers correspond to the 27 approved decisions supplied in review.

| Approved decisions | Final status / location |
|---|---|
| 1 roles; 2 ownership | APPROVED PRODUCT §7/10, PHASE_0 §3/4/6; dual normal profiles, operational ADMIN, company owns after creator leaves, OWNER/MANAGER only |
| 3 lifecycle; 4 material edits | APPROVED PRODUCT §11, plan §5; no CLOSED reopen, duplicate new job, valid existing pending accept, material changes close/duplicate |
| 5 hiring split; 6 lifetime apply; 7 minimum profile | APPROVED PRODUCT §8/12/13, plan §3/5/6 |
| 8 offers; 9 engagement; 10 capacity | APPROVED PRODUCT §7.3/12, plan §5/6; immutable revisions, pending unique, atomic accept, start/request/confirm, audited FORCE, occupied slots |
| 11 reviews product change; 25 review model | APPROVED PRODUCT §13/18, plan §5/6/12; per-Engagement/direction, correct profile/company subject, immutable/no double-blind, hide only, sample counts |
| 12 active quota | APPROVED PRODUCT §24, plan §5/13; three PUBLISHED+PAUSED per owning demand scope, atomic |
| 13 matching; 14 required skills | APPROVED PRODUCT §14, plan §8; unchanged weights, score+coverage/breakdown/version/time, no range UI, configured required boolean eligibility |
| 15 discovery; 16 documents | APPROVED PRODUCT §8/23, plan §6/10; employer-only opted-in discovery, no CV/identity/business docs/general document subsystem |
| 17 accepted invitations; 18 block; 19 polling | APPROVED PRODUCT §16/20, plan §5/10/13; no pending-invite chat, active obligations preserved, polling first |
| 20 auth; 21 verification | APPROVED PRODUCT §19/27, plan §7/13; Better Auth email/password, verified-email gates, phone optional alpha, company badge optional |
| 22 suspension | APPROVED PRODUCT §20, plan §2/4/5/10; deny new activity, preserve required active-obligation access |
| 23 North Star; 24 liquidity | APPROVED PRODUCT §25/26, plan §8/13; completed Engagement, relevant threshold 70/coverage60, versioned history |
| 26 deletion/retention; 27 infrastructure timing | APPROVED PRODUCT §33, plan §2/6/13/14; no legal durations invented, no cascade loss; infrastructure only confirmed-requirement phase |

### Contradictions found and resolved

- PRODUCT old §13/18 required whole Job COMPLETED for reviews; explicit approved product change replaces with Engagement COMPLETED, enabling early completer review. No old gate remains normative.
- PRODUCT old §12 displayed IN_PROGRESS/COMPLETED as Application lifecycle; split now keeps work states on Engagement.
- PRODUCT old §16 opened chat on employer invitation alone; invitation now requires worker acceptance.
- PRODUCT old §27 left Better Auth or Clerk undecided; Better Auth selected, email/password and email verification gates explicit.
- PRODUCT §29 individual employerId-only example insufficient for company ownership; replaced with current company membership/individual ownership check.
- PRODUCT §2 asked about likelihood of being chosen; wording clarified to fit level so no product promise of probabilistic hiring score.
- Old PHASE_0 range UI, optional CV, generic evidence/file subsystem, blanket suspension denial/revocation, and job-complete review wait conflicted with review; removed/replaced. Outbox remains Phase 7 design, not Foundation work.
- Review says offer revoke returns Application SHORTLISTED, while withdrawal/cancellation are terminal: cleanup revocation must not reopen terminal Application. Guard: return to shortlist only while Application OFFERED. This is consistency clarification, not reapply permission.

### Remaining architectural risks / gates

Company/review/conversation subjects must be stable under member departure; compound constraints/scoped queries must encode owner consistency. Review direction unique must use subject entity rather than acting company user to prevent multiple managers submitting duplicates. Quota and capacity must be atomic under concurrent requests. Suspension/block exceptions must be resource/action-scoped and cease when no active obligation remains. Matching missing policy D1 affects threshold interpretation, so approved threshold alone cannot authorize an arbitrary scoring formula. Whole-job terminal transitions D2 must not orphan commitments. Legal durations D7 are pre-production gate, not schema/Foundation gate.

Documentation finalization is complete. No implementation, install, Prisma schema/migration, push or deployment is performed or authorized by this planning step. Stop here.


