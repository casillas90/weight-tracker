#!/usr/bin/env python3
"""
FitTrack Pro - 로컬 개발 및 아이폰/스마트폰 어디서든 접속 가능한 서버
(Wi-Fi 로컬 접속 + Cloudflare 보안 HTTPS 외부 터널 자동 생성)
"""

import http.server
import socketserver
import socket
import subprocess
import webbrowser
import os
import sys
import threading
import re
import json
import atexit

tunnel_process = None
tunnel_url = None

def find_available_port(preferred_ports=[8088, 8000, 8080, 8888]):
    for p in preferred_ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', p)) != 0:
                return p
    return 8088

PORT = find_available_port()

def get_local_ip():
    """맥북의 활성 Wi-Fi 로컬 IP를 조회합니다."""
    for iface in ["en0", "en1"]:
        try:
            ip = subprocess.check_output(["ipconfig", "getifaddr", iface], text=True).strip()
            if ip:
                return ip
        except Exception:
            pass

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

def cleanup():
    global tunnel_process
    if tunnel_process:
        try:
            tunnel_process.terminate()
        except Exception:
            pass

atexit.register(cleanup)

def start_tunnel(port):
    global tunnel_process, tunnel_url
    bin_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cloudflared")
    if not os.path.exists(bin_path):
        return

    try:
        tunnel_process = subprocess.Popen(
            [bin_path, "tunnel", "--url", f"http://localhost:{port}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )

        for line in tunnel_process.stdout:
            match = re.search(r'(https://[a-zA-Z0-9-]+\.trycloudflare\.com)', line)
            if match:
                tunnel_url = match.group(1)
                try:
                    with open("tunnel_info.json", "w", encoding="utf-8") as f:
                        json.dump({"url": tunnel_url, "port": port}, f)
                except Exception:
                    pass

                print(f"""
  🌐 \033[1;32m[외부 어디서든 접속 가능한 보안 HTTPS 주소 생성 완료!]\033[0m
     👉 \033[1;32m{tunnel_url}\033[0m
     (LTE / 5G / 집 밖 / 헬스장 어디서든 아이폰으로 접속 가능)
""")
                break
    except Exception as e:
        print(f"터널 실행 중 오류: {e}")

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    local_ip = get_local_ip()
    local_url = f"http://localhost:{PORT}"
    network_url = f"http://{local_ip}:{PORT}"

    # Remove stale tunnel_info.json
    if os.path.exists("tunnel_info.json"):
        try:
            os.remove("tunnel_info.json")
        except Exception:
            pass

    # Start Cloudflare Tunnel in background
    threading.Thread(target=start_tunnel, args=(PORT,), daemon=True).start()

    banner = f"""
===================================================================
  🏋️‍♂️ FitTrack Pro - 스마트 체중 일기 웹 서버 실행 중
===================================================================

  💻 맥북 브라우저 접속:
     \033[1;36m{local_url}\033[0m

  📱 집 안 Wi-Fi 연결 주소:
     \033[1;33m{network_url}\033[0m

  ⏳ 잠시 후 아이폰/외부 전용 HTTPS 주소가 생성됩니다...
===================================================================
"""
    print(banner)

    # Automatically open local browser
    try:
        webbrowser.open(local_url)
    except Exception:
        pass

    # Start server
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            cleanup()
            print("\n서버가 안전하게 종료되었습니다.")
            sys.exit(0)

if __name__ == '__main__':
    main()
