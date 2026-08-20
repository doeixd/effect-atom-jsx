# Behavior research: `pagination` (seed)

Date: 2026-07-29  
Status: researched  
Tier: supporting seed  
Build priority: later

## 1. Problem statement

Page index + page size atoms for list windows. Seed exists.

## 2. Competitors

Table/data libs more than a11y kits; APG less specific.

**Decision:** Keep as thin state helper; not a machine unless async load
pages.

## 3–9

Snapshot: page, pageSize. Optional total. Tests: seed coverage; clamp page
on size change.
