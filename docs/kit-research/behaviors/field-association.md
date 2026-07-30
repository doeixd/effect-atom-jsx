# Behavior research: `fieldAssociation`

Date: 2026-07-29  
Status: researched  
Tier: T6  
Build priority: supporting

## 1. Problem statement

Wire `label` / `description` / `error` ids to control
(`aria-labelledby`, `aria-describedby`) without manual id plumbing.

## 2. Competitors

Radix Label; react-aria LabelableProvider / useLabel; Base UI Field.

**Decision:** Generate stable ids in setup; publish slots for
label/description/error; set aria on control.

## 3–9

Ids may be snapshot-stable strings. Tests: describedby lists both
description and error when present.
