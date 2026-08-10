@echo off
rem MARS 아침 자가점검 요청 — 작업 스케줄러가 아침(권장 08:50)에 돌린다 (2026-08-10)
rem 대리인(mars-agent)이 켜져 있어야 실제 점검이 돈다 (PC 시작 시 자동 실행 중)
cd /d C:\dev\tyremore
call npx tsx scripts\mars-smoke-request.ts
