@echo off
cd /d "%~dp0"
call node tools\inspecionar.js --id=24463 --tipo=html
echo.
echo Pronto! Agora, em vez de colar aqui, ANEXA (envia como arquivo) o
echo arquivo diagnostico\resposta-html.txt direto na nossa conversa —
echo esse pode ser grande demais pra colar em texto.
pause