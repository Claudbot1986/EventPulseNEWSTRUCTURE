# 03-Queue/testResults

## Purpose

Contains test results and validation reports for queue operations: smoke tests, queue drain tests, retry behavior validation, and worker concurrency tests.

## What belongs here

- Smoke test output logs
- Queue drain test results
- Retry/backoff behavior validation
- Worker concurrency test reports

## What does NOT belong here

- Source code or source test results (belongs to `02-Ingestion/testResults/`)
- Normalizer unit test results (belongs to `04-Normalizer/testResults/`)

## Current Test Coverage

Smoke tests use `smokeTestQueue` (separate from `rawEventsQueue`) for isolated testing.
Queue cleanup: `clearSmokeTestQueue()` removes all job states (completed, failed, wait, active).

## Status

**Status: Placeholder**

Test results should be added here when smoke tests are run. Keep raw output logs for debugging.
