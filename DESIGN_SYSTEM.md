# Design system foundation

Source: [PRODUCT](PRODUCT.md), approved context [PHASE_0 §14](PHASE_0.md#14-repository-documentation-content-plan).

## Current implementation choices

Vietnamese document language, semantic main/h1, responsive text/spacing, neutral light semantic CSS tokens, system sans-serif fonts; no remote font fetch required. Tailwind v4, shadcn manual `components.json` aliases, CSS variables, `cn` via clsx/tailwind-merge, tw-animate-css. No unused component library or icon set installed. Tokens/neutral palette are reversible Foundation choices, not a locked product brand. Add primitives only for real authorized screens.

## Approved product vocabulary

Application/Offer/Engagement are distinct. CLOSED is not COMPLETED and cannot reopen; duplication means a new job. Completion request differs from employer confirmation/case-bound admin force. Reviews per completed Engagement, no edit/double-blind. Match Score is fit level, not hiring probability; score plus coverage/profile completeness, no score ranges. Verification badge is a trust signal, not a safety guarantee. Invitation pending cannot present working chat. Suspension/block must still expose necessary active-obligation actions. No CV/document/payment/AI UI V1.

## Future UI guidance — design proposal

Accessible keyboard/focus labels/errors/contrast, clear empty/loading/error states, local money and pay-period labels, explicit timezone on schedules; format with Intl. Discovery and compensation privacy controls explicit, no public worker directory or raw schedule/contact disclosure. Rating always accompanied by sample count. Do not embed provider/infrastructure details into product flows. Detailed layouts, components and brand remain for authorized UI phases; D1/D3 defaults/score behavior remain deferred where unresolved.
