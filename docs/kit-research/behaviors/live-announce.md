# Behavior research: `liveAnnounce`

Date: 2026-07-29  
Status: researched  
Tier: T7  
Build priority: supporting

## 1. Problem statement

Screen-reader announcements for non-focused updates (toast, typeahead
result count). Must be one region per document, not N widgets.

## 2. Competitors

react-aria LiveAnnouncer; Radix Toast; Zag live-region utils.

**Decision:** `LiveAnnouncer` Context service + Layer; polite/assertive
queues.

## 3–9

Runtime-only. Clear message after timeout. Tests: Layer mock captures
announcements; no DOM in unit tests required if service-injected.
