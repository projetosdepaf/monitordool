@echo off
cd /d "%~dp0"
schtasks /create /tn "Monitor DOE-BA DEPAF" /tr "\"%~dp0rodar-diario.bat\"" /sc daily /st 08:30 /f
echo.
echo Pronto! Criei uma tarefa chamada "Monitor DOE-BA DEPAF" que roda o rodar-diario.bat
echo todo dia as 08:30 (horario deste computador) sozinha, sem voce precisar abrir nada.
echo So funciona se o computador estiver ligado (nao desligado) nesse horario.
pause