@echo off
cd /d "%~dp0"
call node tools\inspecionar.js --caminho=/theme/EGBA/js/home.js
echo.
echo Anexa aqui na conversa o arquivo que apareceu dentro da pasta "diagnostico"
echo (deve se chamar algo como theme-EGBA-js-home-js.txt).
pause