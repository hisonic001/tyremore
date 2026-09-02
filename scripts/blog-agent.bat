@echo off
rem 블로그 원고 대리인 — 앱의 「원고 만들기」 버튼을 받아 구독으로 글을 만든다.
rem 보통은 mars-agent.bat 이 이 창도 같이 띄우므로 따로 실행할 일이 없다.
rem 따로 자동 실행하려면: Win+R → shell:startup → 이 파일의 바로가기를 넣는다.
title Blog agent
cd /d C:\dev\tyremore
npm run blog:agent
pause
