# Behavior research: `searchFilter` (seed)

Date: 2026-07-29  
Status: researched  
Tier: T4 supporting  
Build priority: supporting (seed ✅)

## 1. Problem statement

Filter a list by query string from an input. Seed: query atom + derived
filtered list.

## 2. Competitors

Combobox filtering in Zag/react-aria; match-sorter patterns in apps.

**Decision:** Keep pure filter function option; no fuzzy default. Compose
with collection, not replace it.

## 3–9

Snapshot: query string. Runtime: none beyond atoms. Tests: seed coverage;
empty query shows all.
