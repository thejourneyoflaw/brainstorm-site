@echo off
cd /d "%~dp0"
if not exist logs mkdir logs
echo ===== %date% %time% collect ===== >> logs\collect.log
node collect.mjs >> logs\collect.log 2>&1
echo ===== %date% %time% frontier ===== >> logs\frontier.log
node frontier.mjs >> logs\frontier.log 2>&1
echo ===== %date% %time% deploy ===== >> logs\deploy.log
node build-site.mjs >> logs\deploy.log 2>&1
if not exist site\.git (
  git -C site init -b main >> logs\deploy.log 2>&1
  git -C site config user.name "sldxT" >> logs\deploy.log 2>&1
  git -C site config user.email "sldxT@users.noreply.github.com" >> logs\deploy.log 2>&1
  git -C site remote add origin https://github.com/thejourneyoflaw/brainstorm-site.git >> logs\deploy.log 2>&1
)
git -C site fetch origin main >> logs\deploy.log 2>&1
git -C site reset -q origin/main >> logs\deploy.log 2>&1
git -C site add -A >> logs\deploy.log 2>&1
git -C site diff --cached --quiet || git -C site commit -m "daily update %date%" >> logs\deploy.log 2>&1
git -C site push origin main >> logs\deploy.log 2>&1
