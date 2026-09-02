@echo off
rem MARS 실행 대리인 — 웹의 「자동으로 넣기」 버튼을 받아 실행한다.
rem 윈도우 시작 시 자동 실행: Win+R → shell:startup → 이 파일의 바로가기를 넣는다.
rem ⭐ 블로그 원고 대리인도 여기서 같이 띄운다 (2026-09-02) — 사장님이 하실 일을 늘리지 않는다.
start "Blog agent" cmd /c "cd /d C:\dev\tyremore && npm run blog:agent"
title MARS agent
cd /d C:\dev\tyremore
npm run mars:agent
pause
