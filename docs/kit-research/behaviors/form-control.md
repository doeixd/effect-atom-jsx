# Behavior research: `formControl`

Date: 2026-07-29  
Status: researched  
Tier: T6  
Build priority: **high** (dormancy differentiator)

## 1. Problem statement

Custom widgets must **submit in native forms** and participate in
constraint validation without visible native controls. Hidden input
projection is the standard pattern — and for Affe, must work
**before JS** (dormant).

## 2. Competitors

| Library | Approach |
| --- | --- |
| Radix / most headless | Bubble input or form bind **after** hydration |
| react-aria | hidden input in select/combobox |
| Zag | form utils |
| Native | real input/select |

**Decision:** Hidden native input as **SSR-emitted** default; keep in DOM
for dormant submit. Affe unique: test native form post without JS.

## 3. State vs refs

| Snapshot-safe | Runtime-only |
| --- | --- |
| field value (atom) | input element ref |
| name, required | |

## 4–9

Project `name`, `value`, `disabled`, `required`. Sync atom → input.
`aria-invalid` from validation. Platform floor: prefer styled native
controls when possible. Tests: **form submit without client JS**; value
sync; validation aria.
