# Behavior research: `focusScope`

Date: 2026-07-29  
Status: researched  
Tier: T2  
Build priority: supporting

## 1. Problem statement

On open: move focus to initial element. On close: **restore** focus to
trigger. Unlike trap, may allow tabbing out (non-modal popovers).

## 2. Competitors

Radix FocusScope (trapped vs not); react-aria FocusScope restore;
FloatingFocusManager `returnFocus` / `modal: false`.

**Decision:** Separate from `focusTrap`; options `contain`, `restore`,
`initialFocus`.

## 3–9

Snapshot: none. Runtime: previouslyFocused ref. Platform: dialog restore
automatic. Tests: restore on close; contain false allows outside tab.
