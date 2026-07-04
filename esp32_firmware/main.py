import network
import machine
import socket
import json
import time

def connect_wifi(ssid, password):
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    if not wlan.isconnected():
        print('Connecting to network...')
        wlan.connect(ssid, password)
        while not wlan.isconnected():
            time.sleep(1)
            print('.', end='')
    print('\nNetwork config:', wlan.ifconfig())
    return wlan.ifconfig()[0]

def setup_server(ip, port=80):
    addr = socket.getaddrinfo('0.0.0.0', port)[0][-1]
    s = socket.socket()
    s.bind(addr)
    s.listen(1)
    print('Listening on', addr)
    return s

def handle_request(conn):
    try:
        request = conn.recv(1024)
        req = request.decode('utf-8')
        print("Request:")
        print(req)

        # Simple routing
        if "POST /api/gpio/write" in req:
            # Parse body (very simple json parse for demo)
            try:
                body_start = req.find('\r\n\r\n') + 4
                body = req[body_start:]
                data = json.loads(body)
                pin = data.get('pin')
                value = data.get('value')
                
                if pin is not None and value is not None:
                    p = machine.Pin(int(pin), machine.Pin.OUT)
                    p.value(int(value))
                    response = json.dumps({"success": True, "pin": pin, "value": value})
                    conn.send('HTTP/1.1 200 OK\nContent-Type: application/json\n\n')
                    conn.send(response)
                else:
                    conn.send('HTTP/1.1 400 Bad Request\n\nMissing pin or value')
            except Exception as e:
                conn.send('HTTP/1.1 500 Internal Error\n\n' + str(e))
        else:
            conn.send('HTTP/1.1 404 Not Found\n\n')
    except Exception as e:
        print(e)
    finally:
        conn.close()

def main():
    # Replace with your actual WiFi credentials via config file or user input
    # ssid = 'YOUR_SSID'
    # password = 'YOUR_PASSWORD'
    # ip = connect_wifi(ssid, password)
    
    # s = setup_server(ip, 80)
    # while True:
    #     conn, addr = s.accept()
    #     print('Client connected from', addr)
    #     handle_request(conn)
    print("ESP32 REST Bridge stub ready. Update with actual WiFi credentials to run.")

if __name__ == '__main__':
    main()
