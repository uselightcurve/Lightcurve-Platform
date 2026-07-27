@echo off
cd /d C:\Users\ashit\OneDrive\Documents\Lightcurve
echo Starting Lightcurve at %date% %time% > run-localhost.log
call node_modules\.bin\next.cmd dev --webpack --hostname 127.0.0.1 --port 3000 >> run-localhost.log 2>&1
echo Exited with %ERRORLEVEL% at %date% %time% >> run-localhost.log
