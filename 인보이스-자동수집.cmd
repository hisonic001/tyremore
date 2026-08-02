@echo off
chcp 65001 >nul
title 타이어모어 - 인보이스 자동 수집
cd /d "%~dp0"
echo.
echo   이 창을 켜 두시면 미쉐린·콘티넨탈·금호 엑셀을 내려받는 대로
echo   자동으로 「입고 예정」에 올라갑니다.
echo.
echo   끝내시려면 이 창을 닫으시면 됩니다.
echo.
call npm run collect
echo.
echo   멈췄습니다. 창을 닫으셔도 됩니다.
pause
