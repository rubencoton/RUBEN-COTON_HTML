@echo off
REM Arranca el servidor Node si no esta corriendo y abre la app en el navegador
cd /d "%~dp0"

REM Comprobar si el servidor ya esta corriendo en puerto 8090
netstat -ano | findstr ":8090.*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo Servidor ya esta corriendo en puerto 8090
) else (
    echo Arrancando servidor Node...
    start /B "" cmd /c "node server.js"
    REM Esperar 2s para que el servidor arranque
    timeout /t 2 /nobreak >nul
)

REM Abrir el navegador en la URL del servidor
start "" "http://localhost:8090"
exit
