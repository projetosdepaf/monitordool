@echo off
cd /d "%~dp0"
set NODE_OPTIONS=--use-system-ca
echo ---- %date% %time% ---- >> log.txt
git pull >> log.txt 2>&1
call node scraper.js >> log.txt 2>&1
git add docs\data
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Atualiza dados do Diario (%date%)" >> log.txt 2>&1
  git push >> log.txt 2>&1
) else (
  echo Nada novo hoje. >> log.txt
)