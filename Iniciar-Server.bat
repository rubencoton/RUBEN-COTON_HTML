@echo off
REM RUBEN COTON - Email Builder LOCAL FULL
REM Arranca server.js en puerto 8090 + abre browser
REM (NO modifica index.html, server.js ni nada del proyecto)

cd /d "%~dp0"
echo ===============================================
echo RUBEN COTON - Email Builder LOCAL
echo ===============================================
echo.
echo Iniciando servidor en http://localhost:8090
echo (cierra esta ventana para parar el servidor)
echo.

REM Verifica que node este disponible
where node >nul 2>nul
if errorlevel 1 (
    echo ERROR: Node.js no esta instalado o no esta en PATH
    echo Instalalo desde https://nodejs.org/
    pause
    exit /b 1
)

REM Abre el browser apuntando al server (con delay para que arranque primero)
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8090/"

REM Arranca el server.js (bloquea hasta que cierras la ventana)
node server.js
