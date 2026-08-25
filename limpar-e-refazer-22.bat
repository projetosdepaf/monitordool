@echo off
cd /d "%~dp0"
node tools\remover-edicao.js --id=22422
echo.
echo Buscando o dia 22/08 de novo, com a extracao corrigida...
call node scraper.js --data=2026-08-22 --id=22422

git add docs\data
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Corrige dados do dia 22/08/2026 com extracao real"
  git push
) else (
  echo Nada novo pra salvar.
)
echo.
pause