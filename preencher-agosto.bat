@echo off
cd /d "%~dp0"

echo ---- %date% %time% ---- >> preencher-log.txt
echo Buscando as edições de agosto/2026 (isso demora uns minutos, tem uma edição por vez)... >> preencher-log.txt
git pull >> preencher-log.txt 2>&1
call node tools\backfill.js --de=2026-08-01 --ate=2026-08-24 >> preencher-log.txt 2>&1

git add docs\data
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Preenche historico de agosto/2026" >> preencher-log.txt 2>&1
  git push >> preencher-log.txt 2>&1
) else (
  echo Nada novo pra salvar (pode ser que ja estivesse tudo la, ou nao achou nada no periodo). >> preencher-log.txt
)

echo.
echo Pronto! Confira o arquivo preencher-log.txt (nesta mesma pasta) pra ver o
echo que ele encontrou dia a dia. Depois de uns minutinhos, o painel no GitHub
echo Pages deve mostrar as publicacoes de agosto tambem.
echo.
pause