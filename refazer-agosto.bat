@echo off
cd /d "%~dp0"
echo Reprocessando agosto inteiro com a extracao corrigida (isso pode demorar alguns minutos, deixa rodando)...
node tools\reprocessar-mes.js --de=2026-08-01 --ate=2026-08-25
echo.
echo Salvando o script novo e os dados atualizados...
git add lib\portal.js tools\reprocessar-mes.js docs\data\matches.json docs\data\processed-editions.json
git commit -m "Reprocessa agosto inteiro com extracao de decretos em lote"
echo.
echo Baixando o que tem no GitHub e juntando com o que voce tem local...
git pull --no-rebase -X ours --no-edit origin main
echo.
echo Enviando pro GitHub...
git push
echo.
echo Pronto! Confere o painel.
pause