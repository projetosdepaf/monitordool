@echo off
cd /d "%~dp0"
echo Baixando o que tem no GitHub... > sincronizar-log.txt
git pull --no-rebase -X ours origin main >> sincronizar-log.txt 2>&1
echo. >> sincronizar-log.txt
echo Enviando de novo... >> sincronizar-log.txt
git push >> sincronizar-log.txt 2>&1
echo. >> sincronizar-log.txt
echo === Fim === >> sincronizar-log.txt
echo.
echo Pronto! Me manda o sincronizar-log.txt
pause