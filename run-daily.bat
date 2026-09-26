@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
echo ===== %date% %time% ===== >> logs\collect.log
node collect.mjs >> logs\collect.log 2>&1
echo ===== %date% %time% 部署站点 ===== >> logs\deploy.log
node build-site.mjs >> logs\deploy.log 2>&1
git -C site add -A >> logs\deploy.log 2>&1
git -C site diff --cached --quiet || git -C site commit -m "daily update %date%" >> logs\deploy.log 2>&1
git -C site push >> logs\deploy.log 2>&1
