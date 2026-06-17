@echo off
echo.
echo  Artifacts Coffee — Local Preview Server
echo  ----------------------------------------
echo.

REM Add firewall rule to allow port 8080 (runs once, silently)
netsh advfirewall firewall add rule name="Artifacts Coffee Preview" dir=in action=allow protocol=TCP localport=8080 >nul 2>&1

echo  Your IP addresses (try each on your phone):
echo.
ipconfig | findstr /i "IPv4"
echo.
echo  Use the 192.168.x.x address (your WiFi).
echo  Open on phone:  http://192.168.x.x:8080/instagram_posts/post_03_office/_ab_test.html
echo.
echo  Full index:     http://192.168.x.x:8080/instagram_posts/_index.html
echo.
echo  Press Ctrl+C to stop.
echo.
cd /d "%~dp0"
python -m http.server 8080
