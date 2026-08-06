@echo off
rem 타이어모어 DB 자동 백업 (작업 스케줄러가 매일 부른다, 2026-08-05)
cd /d C:\dev\tyremore
echo ===== %date% %time% ===== >> C:\dev\tyremore-data\backup\backup.log
call npx tsx scripts/backup-db.ts >> C:\dev\tyremore-data\backup\backup.log 2>&1
echo exit=%errorlevel% >> C:\dev\tyremore-data\backup\backup.log
