@echo off
cd /d "%~dp0"
echo. > git-diagnostico-log.txt
echo === Pasta atual === >> git-diagnostico-log.txt
cd >> git-diagnostico-log.txt
echo. >> git-diagnostico-log.txt
echo === Repositorio remoto (deve apontar pro seu GitHub) === >> git-diagnostico-log.txt
git remote -v >> git-diagnostico-log.txt 2>&1
echo. >> git-diagnostico-log.txt
echo === Branch atual === >> git-diagnostico-log.txt
git branch >> git-diagnostico-log.txt 2>&1
echo. >> git-diagnostico-log.txt
echo === Ultimos commits salvos === >> git-diagnostico-log.txt
git log -5 --oneline >> git-diagnostico-log.txt 2>&1
echo. >> git-diagnostico-log.txt
echo === O que ainda nao foi enviado === >> git-diagnostico-log.txt
git status >> git-diagnostico-log.txt 2>&1
echo. >> git-diagnostico-log.txt
echo === Tentando salvar e enviar agora === >> git-diagnostico-log.txt
git add docs\data
git commit -m "Atualiza dados de agosto/2026" >> git-diagnostico-log.txt 2>&1
git push >> git-diagnostico-log.txt 2>&1
echo. >> git-diagnostico-log.txt
echo === Fim === >> git-diagnostico-log.txt
echo.
echo Pronto! Pode fechar essa janela e me mandar o arquivo git-diagnostico-log.txt
pause