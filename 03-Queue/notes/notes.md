# 03-Queue/notes

## Purpose

Operational notes about the queue system: monitoring, failure handling, common issues, and runbooks.

## Queue Health Monitoring

Key indicators:
- **Queue depth** — `rawEventsQueue.getJobCounts()` should be low in steady state
- **Failed jobs** — `smokeTestQueue.getFailed()` should be empty or near-empty
- **Stuck active jobs** — workers should be processing continuously
- **Redis connectivity** — all workers depend on Redis being reachable

## Common Failure Modes

### Redis connection failure
- Symptoms: `ENOTFOUND`, `ECONNREFUSED` on worker startup
- Cause: Wrong `REDIS_URL` or Redis server not running
- Fix: Verify `REDIS_URL` env var, check Redis container

### Normalizer worker crashes
- Symptoms: Jobs move to failed state with no error log
- Cause: Unhandled exception in `processRawEvent`
- Fix: Check `normalizer.ts` error handling, ensure Supabase is reachable

### Queue backlog buildup
- Symptoms: Job counts growing without draining
- Cause: Worker down, or downstream (Supabase) too slow
- Fix: Check worker process, check Supabase latency

### Race condition on venue creation
- Symptom: PostgreSQL `23505` unique_violation on venue insert
- This is **expected and handled** — normalizer catches it and re-fetches existing venue

## What belongs here

- Operational runbooks
- Queue monitoring commands
- Failure diagnosis procedures
- Redis/queue health check scripts

## What does NOT belong here

- Source code (lives in `services/ingestion/src/`)
- Database schemas (lives in `05-Supabase/`)

## Status

**Status: Under uppbyggnad**

Add specific monitoring commands and runbooks as operational experience accumulates.
